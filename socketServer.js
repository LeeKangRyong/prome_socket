require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// .env 파일에서 포트 가져오기
const serverPort = process.env.SOCKET_PORT; 

const app = express();
const server = app.listen(serverPort, () => {
    console.log(`소켓 서버 ${serverPort} 포트에서 실행 중입니다.`);
});

const io = new Server(server, {
    cors: {
        origin: '*', // 실제 배포 시, 특정 도메인으로 제한하는 것이 좋습니다.
        methods: ['GET', 'POST']
    }
});

const maxClientsPerRoom = 2; // 한 방당 최대 클라이언트 수 (예: 1:1 통화)

// rooms 객체 구조 변경: { roomId: { clients: [socketId1, socketId2], caller: socketId1 }, ... }
const rooms = {}; 
const users = {}; // 사용자 ID와 소켓 ID 매핑 { userId: socketId, ... }
const socketToUser = {}; // 소켓 ID와 사용자 ID 매핑 { socketId: userId, ... }

io.on('connection', (socket) => {
    console.log(`클라이언트 연결됨: ${socket.id}`);

    // 1. 사용자 등록 (클라이언트에서 'register' 이벤트로 userId 전송)
    socket.on('register', (userId) => {
        users[userId] = socket.id;
        socketToUser[socket.id] = userId;
        console.log(`사용자 ${userId} (Socket ID: ${socket.id}) 등록됨`);
    });

    // 2. 방 생성 또는 참여 요청
    socket.on('joinRoom', async ({ roomId, userId }) => {
        if (!rooms[roomId]) {
            // 방이 없으면 새로 생성하고 첫 입장자를 caller로 설정
            rooms[roomId] = {
                clients: [],
                caller: socket.id // 방의 첫 입장자를 caller로 지정
            };
            console.log(`방 ${roomId}이 생성되었습니다. 첫 입장자: ${userId}`);
        }

        const currentRoom = rooms[roomId];

        if (currentRoom.clients.length >= maxClientsPerRoom) {
            console.log(`방 ${roomId}은 이미 가득 찼습니다.`);
            socket.emit('roomFull'); // 방이 가득 찼음을 클라이언트에 알림
            return;
        }

        // 이미 방에 있는 경우 중복 조인 방지
        if (currentRoom.clients.includes(socket.id)) {
            console.log(`사용자 ${userId} (Socket ID: ${socket.id})는 이미 방 ${roomId}에 있습니다.`);
            return;
        }

        await socket.join(roomId); // Socket.IO의 join 메소드는 비동기
        currentRoom.clients.push(socket.id);
        console.log(`사용자 ${userId} (Socket ID: ${socket.id})가 방 ${roomId}에 참여했습니다.`);

        // 두 명의 클라이언트가 모두 들어왔을 때 통화 시작 준비 알림
        if (currentRoom.clients.length === maxClientsPerRoom) {
            const callerSocketId = currentRoom.caller; // 방의 첫 입장자가 caller가 됩니다.
            const callerUserId = socketToUser[callerSocketId];
            
            console.log(`방 ${roomId} 준비 완료! Caller: ${callerUserId}`);
            
            // 방의 모든 클라이언트에게 통화 준비 완료 메시지 전송 (callerId 명시)
            io.to(roomId).emit('readyForCall', { callerId: callerUserId });
        } else if (currentRoom.clients.length < maxClientsPerRoom) {
            // 아직 상대방이 들어오지 않았다면 기다리라고 알림
            socket.emit('waitingForOpponent');
        }
    });

    // 3. WebRTC 시그널링 이벤트 처리

    // Offer 교환
    socket.on('offer', ({ toUserId, offer, roomId }) => {
        const targetSocketId = users[toUserId];
        if (targetSocketId) {
            console.log(`Offer from ${socketToUser[socket.id]} to ${toUserId} in room ${roomId}`);
            io.to(targetSocketId).emit('offer', { fromUserId: socketToUser[socket.id], offer: offer, roomId: roomId });
        } else {
            console.warn(`Offer: 대상 사용자 ${toUserId}를 찾을 수 없습니다.`);
        }
    });

    // Answer 교환
    socket.on('answer', ({ toUserId, answer, roomId }) => {
        const targetSocketId = users[toUserId];
        if (targetSocketId) {
            console.log(`Answer from ${socketToUser[socket.id]} to ${toUserId} in room ${roomId}`);
            io.to(targetSocketId).emit('answer', { fromUserId: socketToUser[socket.id], answer: answer, roomId: roomId });
        } else {
            console.warn(`Answer: 대상 사용자 ${toUserId}를 찾을 수 없습니다.`);
        }
    });

    // ICE Candidate 교환
    socket.on('iceCandidate', ({ toUserId, candidate, roomId }) => {
        const targetSocketId = users[toUserId];
        if (targetSocketId) {
            console.log(`ICE Candidate from ${socketToUser[socket.id]} to ${toUserId} in room ${roomId}`);
            io.to(targetSocketId).emit('iceCandidate', { fromUserId: socketToUser[socket.id], candidate: candidate, roomId: roomId });
        } else {
            console.warn(`ICE Candidate: 대상 사용자 ${toUserId}를 찾을 수 없습니다.`);
        }
    });

    // 4. 통화 종료
    socket.on('callEnd', ({ toUserId, roomId }) => {
        const targetSocketId = users[toUserId];
        if (targetSocketId) {
            console.log(`통화 종료 요청: ${socketToUser[socket.id]} -> ${toUserId} (방: ${roomId})`);
            io.to(targetSocketId).emit('callEnd', { fromUserId: socketToUser[socket.id] });
        }
        // 방에서 클라이언트 제거 (방이 비면 방 자체를 삭제)
        if (rooms[roomId]) {
            rooms[roomId].clients = rooms[roomId].clients.filter(id => id !== socket.id);
            if (rooms[roomId].clients.length === 0) {
                delete rooms[roomId];
                console.log(`방 ${roomId}이 비었습니다. 삭제.`);
            }
        }
    });

    // 5. 연결 해제
    socket.on('disconnect', () => {
        const userId = socketToUser[socket.id];
        if (userId) {
            delete users[userId];
            delete socketToUser[socket.id];
            console.log(`사용자 ${userId} (Socket ID: ${socket.id}) 연결 해제됨`);

            // 연결이 끊긴 클라이언트가 속해 있던 방에서 제거 및 상대방에게 알림
            for (const roomId in rooms) {
                const roomData = rooms[roomId];
                const clientIndex = roomData.clients.indexOf(socket.id);
                
                if (clientIndex > -1) {
                    roomData.clients.splice(clientIndex, 1); // 배열에서 자신 제거
                    
                    if (roomData.clients.length === 0) {
                        delete rooms[roomId];
                        console.log(`방 ${roomId}이 비었습니다. 삭제.`);
                    } else {
                        // 방에 남아있는 다른 클라이언트에게 연결 해제 알림
                        // 1:1 통화이므로 남아있는 클라이언트는 rooms[roomId].clients 배열의 유일한 요소
                        const remainingSocketId = roomData.clients[0]; 
                        io.to(remainingSocketId).emit('opponentDisconnected', { roomId: roomId, disconnectedUserId: userId });
                        console.log(`방 ${roomId}에 남아있는 클라이언트에게 ${userId}의 연결 해제 알림 전송`);
                    }
                }   
            }
        } else {
            console.log(`알 수 없는 클라이언트 ${socket.id} 연결 해제됨`);
        }
    });
});
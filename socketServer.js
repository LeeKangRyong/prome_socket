require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

console.log(process.env.SOCKET_PORT);
const app = express();
const serverPort = process.env.SOCKET_PORT;
console.log(serverPort);

const server = app.listen(serverPort, () => {
    console.log("소켓 서버 "+ serverPort);
});

const io = new Server(server, { // new Server()로 사용
    cors: {
        origin: '*', // 실제 배포 시, 특정 도메인 이용
        methods: ['GET', 'POST']
    }
});

const maxClientsPerRoom = 2; // 한 방당 최대 클라이언트 수 (예: 1:1 통화)
const rooms = {}; // 현재 방들의 상태를 저장할 객체 { roomId: [socketId1, socketId2, ...], ... }
const users = {}; // 사용자 ID와 소켓 ID 매핑 { userId: socketId, ... }
const socketToUser = {}; // 소켓 ID와 사용자 ID 매핑 { socketId: userId, ... }

io.on('connection', (socket) => {
    console.log(`클라이언트 연결됨: ${socket.id}`);

    // 1. 사용자 등록 (클라이언트에서 'register' 이벤트로 userId 전송)
    socket.on('register', (userId) => {
        users[userId] = socket.id;
        socketToUser[socket.id] = userId;
        console.log(`사용자 ${userId} (Socket ID: ${socket.id}) 등록됨`);
    // 특정 사용자에게만 온라인 사용자 목록을 보내거나, 전체에게 보낼 수 있습니다.
    // 여기서는 간단히 등록만 합니다.
    });

    // 2. 방 생성 또는 참여 요청
    socket.on('joinRoom', async ({ roomId, userId }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }

        if (rooms[roomId].length >= maxClientsPerRoom) {
            console.log(`방 ${roomId}은 이미 가득 찼습니다.`);
            socket.emit('roomFull'); // 방이 가득 찼음을 클라이언트에 알림
        return;
        }

        // 이미 방에 있는 경우 중복 조인 방지 (선택 사항)
        if (rooms[roomId].includes(socket.id)) {
            console.log(`사용자 ${userId} (Socket ID: ${socket.id})는 이미 방 ${roomId}에 있습니다.`);
        return;
        }

        await socket.join(roomId); // Socket.IO의 join 메소드는 비동기
        rooms[roomId].push(socket.id);
        console.log(`사용자 ${userId} (Socket ID: ${socket.id})가 방 ${roomId}에 참여했습니다.`);

        // 방에 있는 모든 클라이언트에게 새로운 클라이언트 참여 알림
        // 단, 1:1 통화라면 상대방에게만 알리면 됩니다.
        if (rooms[roomId].length === maxClientsPerRoom) {
            // 두 명의 클라이언트가 모두 들어왔을 때 통화 시작 준비 알림
            const otherSocketId = rooms[roomId].find(id => id !== socket.id);
            if (otherSocketId) {
                io.to(otherSocketId).emit('readyForCall', { callerId: userId });
                socket.emit('readyForCall', { callerId: socketToUser[otherSocketId] });
            }
        } else if (rooms[roomId].length < maxClientsPerRoom) {
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
            rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
            if (rooms[roomId].length === 0) {
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

        // 연결이 끊긴 클라이언트가 속해 있던 방에서 제거
        for (const roomId in rooms) {
            const index = rooms[roomId].indexOf(socket.id);
                if (index > -1) {
                    rooms[roomId].splice(index, 1);
                    if (rooms[roomId].length === 0) {
                        delete rooms[roomId];
                        console.log(`방 ${roomId}이 비었습니다. 삭제.`);
                    } else {
                        // 방에 남아있는 다른 클라이언트에게 연결 해제 알림
                        io.to(rooms[roomId][0]).emit('opponentDisconnected', { roomId: roomId, disconnectedUserId: userId });
                    }
                }   
            }
        } else {
            console.log(`알 수 없는 클라이언트 ${socket.id} 연결 해제됨`);
        }
    });
});
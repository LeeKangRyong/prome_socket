require('dotenv').config();
const express = require('express');
const multer = require('multer'); // 파일 업로드를 처리하기 위한 미들웨어
const cors = require('cors'); // CORS 허용을 위한 미들웨어
const path = require('path'); // 파일 경로 처리를 위한 모듈
const fs = require('fs'); // 파일 시스템 접근을 위한 모듈

const app = express();
const uploadPort = process.env.SOCKET_PORT;

// CORS 허용: 모든 출처에서 접근 가능하도록 설정 (개발 단계에서만 사용)
app.use(cors());

// 파일 저장 경로 설정
const uploadsDir = path.join(__dirname, 'uploads'); // 현재 스크립트 파일이 있는 디렉토리의 'uploads' 폴더
if (!fs.existsSync(uploadsDir)) { // 'uploads' 폴더가 없으면 생성
    fs.mkdirSync(uploadsDir);
    console.log(`'uploads' 폴더가 생성되었습니다: ${uploadsDir}`);
}

// Multer 설정: 파일 저장 위치 및 파일명 정의
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir); // 파일을 저장할 디렉토리
    },
    filename: (req, file, cb) => {
        // 파일명: 원본 파일명 앞에 현재 시간을 붙여 중복 방지
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// 파일 업로드 엔드포인트
app.post('/upload-audio', upload.single('audio'), (req, res) => {
    // 'audio'는 React Native 앱에서 RNFS.uploadFiles의 name 필드와 동일해야 합니다.
    if (!req.file) {
        console.log('업로드된 파일이 없습니다.');
        return res.status(400).json({ message: '업로드된 파일이 없습니다.' });
    }

    console.log(`파일이 성공적으로 업로드되었습니다: ${req.file.filename}`);
    console.log(`저장 경로: ${req.file.path}`);
    console.log('추가 필드:', req.body); // RNFS.uploadFiles에서 fields에 보낸 데이터 확인 가능

    res.status(200).json({
        message: '오디오 파일이 성공적으로 업로드되었습니다.',
        filename: req.file.filename,
        filepath: req.file.path,
        fields: req.body // 전송받은 추가 필드도 함께 응답
    });
});

// 서버 시작
app.listen(uploadPort, () => {
    console.log(`녹음 파일 업로드 서버가 ${uploadPort} 포트에서 실행 중입니다.`);
    console.log(`파일 저장 디렉토리: ${uploadsDir}`);
});
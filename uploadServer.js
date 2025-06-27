require('dotenv').config();
const express = require('express');
const multer = require('multer'); 
const cors = require('cors'); 
const path = require('path'); 
const fs = require('fs'); 

const app = express();
// 중요 수정: SOCKET_PORT가 아닌 UPLOAD_PORT 사용
const uploadPort = process.env.UPLOAD_PORT; 

app.use(cors());

const uploadsDir = path.join(__dirname, 'uploads'); 
if (!fs.existsSync(uploadsDir)) { 
    fs.mkdirSync(uploadsDir);
    console.log(`'uploads' 폴더가 생성되었습니다: ${uploadsDir}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir); 
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

app.post('/upload-audio', upload.single('audio'), (req, res) => {
    if (!req.file) {
        console.log('업로드된 파일이 없습니다.');
        return res.status(400).json({ message: '업로드된 파일이 없습니다.' });
    }

    console.log(`파일이 성공적으로 업로드되었습니다: ${req.file.filename}`);
    console.log(`저장 경로: ${req.file.path}`);
    console.log('추가 필드:', req.body);

    res.status(200).json({
        message: '오디오 파일이 성공적으로 업로드되었습니다.',
        filename: req.file.filename,
        filepath: req.file.path,
        fields: req.body 
    });
});

app.listen(uploadPort, () => {
    console.log(`녹음 파일 업로드 서버가 ${uploadPort} 포트에서 실행 중입니다.`);
    console.log(`파일 저장 디렉토리: ${uploadsDir}`);
});
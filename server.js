const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');
const mongoose = require('mongoose'); // Thêm thư viện MongoDB

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sseClients = []; 

// ==========================================
// 1. KẾT NỐI MONGODB VÀ ĐỊNH NGHĨA CẤU TRÚC (SCHEMA)
// ==========================================
// Thay chuỗi kết nối của bạn vào đây (Hoặc dùng biến môi trường trên Render)
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dungpt2414986:Dungd0vd#@airproject.arxmcfi.mongodb.net/?appName=AirProject";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Đã kết nối cơ sở dữ liệu MongoDB Atlas thành công!'))
    .catch(err => console.error('⚠️ Lỗi kết nối MongoDB:', err));

// Tạo khuôn mẫu (Schema) cho dữ liệu môi trường
const dataSchema = new mongoose.Schema({
    pm25: Number,
    pm10: Number,
    temp: Number,
    hum: Number,
    timeLabel: String,
    dateLabel: String,
    createdAt: { type: Date, default: Date.now } // Tự động lưu mốc thời gian ghi vào DB
});

// Tạo Model để thao tác với bảng dữ liệu
const SensorData = mongoose.model('SensorData', dataSchema);

// ==========================================
// HÀM BƠM DỮ LIỆU SSE (GIỮ NGUYÊN)
// ==========================================
function broadcastToBrowsers(data) {
    sseClients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// ==========================================
// 2. KẾT NỐI MQTT (LƯU VÀO MONGODB)
// ==========================================
const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');
const myTopic = 'airsense/hust/tiendung_2507';

mqttClient.on('connect', () => {
    console.log('✅ Kết nối MQTT thành công!');
    mqttClient.subscribe(myTopic);
});

mqttClient.on('message', async (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        const now = new Date();
        payload.timeLabel = now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        payload.dateLabel = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

        // Tạo bản ghi mới và LƯU VÀO MONGODB
        const newData = new SensorData(payload);
        await newData.save(); 

        broadcastToBrowsers(payload);
        console.log(`[MQTT -> MongoDB] Đã lưu dữ liệu: ${payload.temp}°C`);
    } catch (error) {
        console.error("⚠️ Lỗi xử lý MQTT:", error);
    }
});

// ==========================================
// 3. API NHẬN DỮ LIỆU ĐỒNG BỘ TỪ THẺ SD (LƯU VÀO MONGODB)
// ==========================================
app.post('/api/sync', async (req, res) => {
    try {
        const payload = req.body;
        const parts = payload.timestamp.split(' ');
        
        const syncData = {
            pm25: parseFloat(payload.pm25),
            pm10: parseFloat(payload.pm10),
            temp: parseFloat(payload.temp),
            hum: parseFloat(payload.hum),
            timeLabel: parts[1] || '00:00:00',
            dateLabel: parts[0] || '1/1/2026'
        };

        // Lưu bản ghi đồng bộ bù vào MongoDB
        const newData = new SensorData(syncData);
        await newData.save();

        broadcastToBrowsers(syncData);
        console.log(`[SD SYNC -> MongoDB] Đã đồng bộ lúc: ${payload.timestamp}`);
        res.status(200).send("OK");
    } catch (error) {
        res.status(500).send("Error");
    }
});

// ==========================================
// 4. API LẤY LỊCH SỬ KHI MỞ WEB (TRUY VẤN TỪ MONGODB)
// ==========================================
app.get('/api/data', async (req, res) => {
    try {
        const history = await SensorData.find().sort({ createdAt: -1 }).limit(50);
        res.json(history.reverse());
    } catch (error) {
        console.error("Lỗi khi đọc MongoDB:", error); // In lỗi ra log của Render để dễ tìm
        res.status(500).json([]); // <--- SỬA DÒNG NÀY: Trả về mảng rỗng định dạng JSON
    }
});

// ==========================================
// 5. KÊNH SSE REAL-TIME (GIỮ NGUYÊN)
// ==========================================
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    sseClients.push(res);
    req.on('close', () => { sseClients = sseClients.filter(client => client !== res); });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Node.js đang chạy tại Port ${PORT}`);
});
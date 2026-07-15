const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let sseClients = []; 

// ==========================================
// 1. KẾT NỐI MONGODB VÀ ĐỊNH NGHĨA CẤU TRÚC (SCHEMA)
// ==========================================
// Ký tự '#' trong mật khẩu đã được mã hóa thành '%23' để tránh lỗi MongoParseError
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dungpt2414986:Dungd0vd@airproject.b9ikxf5.mongodb.net/?appName=AirProject";

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 30000, // Tăng sức chịu đựng mạng lên 30s
    socketTimeoutMS: 45000           // Giữ kết nối sống lâu hơn để chống rớt mạng
})
    .then(() => console.log('✅ Đã kết nối cơ sở dữ liệu MongoDB Atlas thành công!'))
    .catch(err => console.error('⚠️ Lỗi kết nối MongoDB:', err.message));

// Tạo khuôn mẫu (Schema) cho dữ liệu môi trường
const dataSchema = new mongoose.Schema({
    pm25: Number,
    pm10: Number,
    temp: Number,
    hum: Number,
    timeLabel: String,
    dateLabel: String,
    createdAt: { type: Date, default: Date.now } 
});

const SensorData = mongoose.model('SensorData', dataSchema);

// ==========================================
// HÀM BƠM DỮ LIỆU SSE 
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

        const newData = new SensorData(payload);
        await newData.save(); 

        broadcastToBrowsers(payload);
        console.log(`[MQTT -> MongoDB] Đã lưu dữ liệu: Nhiệt độ ${payload.temp}°C | PM2.5: ${payload.pm25}`);
    } catch (error) {
        console.error("⚠️ Lỗi lưu dữ liệu MQTT vào MongoDB:", error.message);
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
        console.error("Lỗi khi đọc MongoDB:", error.message);
        res.status(500).json([]); 
    }
});

// ==========================================
// 5. API KIỂM TRA TRẠNG THÁI MÁY CHỦ (HEALTH CHECK)
// ==========================================
app.get('/api/ping', (req, res) => {
    res.status(200).send("Server is awake!");
});

// ==========================================
// 6. KÊNH SSE REAL-TIME 
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
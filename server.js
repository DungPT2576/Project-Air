const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Phục vụ giao diện tĩnh
app.use(express.static(path.join(__dirname, 'public')));

let dataHistory = [];
let sseClients = []; // Danh sách các trình duyệt đang mở web

// ==========================================
// HÀM BƠM DỮ LIỆU XUỐNG TẤT CẢ TRÌNH DUYỆT ĐANG MỞ
// ==========================================
function broadcastToBrowsers(data) {
    sseClients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// ==========================================
// 1. KẾT NỐI MQTT (CHỈ SERVER MỚI DÙNG MQTT)
// ==========================================
const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');
const myTopic = 'airsense/hust/tiendung_2507';

mqttClient.on('connect', () => {
    console.log('✅ Máy chủ Render đã kết nối MQTT thành công!');
    mqttClient.subscribe(myTopic);
});

mqttClient.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        const now = new Date();
        
        // Gắn nhãn thời gian Việt Nam
        payload.timeLabel = now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        payload.dateLabel = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

        dataHistory.push(payload);
        if (dataHistory.length > 50) dataHistory.shift();

        // 🚀 BƠM TRỰC TIẾP XUỐNG GIAO DIỆN WEB
        broadcastToBrowsers(payload);
        console.log(`[MQTT REAL-TIME] Đã đẩy dữ liệu: ${payload.temp}°C`);
    } catch (error) {
        console.error("⚠️ Lỗi parse MQTT:", error);
    }
});

// ==========================================
// 2. API HTTP POST: NHẬN DỮ LIỆU GỬI BÙ TỪ THẺ SD
// ==========================================
app.post('/api/sync', (req, res) => {
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

        dataHistory.push(syncData);
        if (dataHistory.length > 50) dataHistory.shift();

        // 🚀 BƠM DỮ LIỆU QUÁ KHỨ VỪA ĐỒNG BỘ LÊN GIAO DIỆN
        broadcastToBrowsers(syncData);
        console.log(`[SD OFFLINE SYNC] Đã xử lý dữ liệu lúc: ${payload.timestamp}`);
        res.status(200).send("OK");
    } catch (error) {
        console.error("⚠️ Lỗi đồng bộ SD:", error);
        res.status(500).send("Error");
    }
});

// ==========================================
// 3. API GET: TRẢ VỀ LỊCH SỬ KHI VỪA MỞ TRANG WEB
// ==========================================
app.get('/api/data', (req, res) => {
    res.json(dataHistory);
});

// ==========================================
// 4. API SSE: KÊNH GIỮ KẾT NỐI REAL-TIME VỚI TRÌNH DUYỆT
// ==========================================
app.get('/api/stream', (req, res) => {
    // Thiết lập Header HTTP không bao giờ ngắt kết nối
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại Port ${PORT}`);
});
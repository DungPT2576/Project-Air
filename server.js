const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(cors());
// Phục vụ giao diện web tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

let dataHistory = []; // Bộ nhớ đệm RAM lưu 50 điểm

// 1. KẾT NỐI SERVER VỚI MQTT BROKER
const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');
const myTopic = 'airsense/hust/tram_do_cua_dung_2507'; // Phải giống hệt trong code ESP32

mqttClient.on('connect', () => {
    console.log('✅ Máy chủ Render đã kết nối thành công với MQTT Broker!');
    mqttClient.subscribe(myTopic);
});

mqttClient.on('message', (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        
        // Tạo nhãn thời gian cho Server (Theo múi giờ Việt Nam)
        const now = new Date();
        const timeStr = now.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
        const dateStr = now.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        
        payload.timeLabel = timeStr;
        payload.dateLabel = dateStr;

        // Lưu vào mảng và chống tràn (giới hạn 50 phần tử)
        dataHistory.push(payload);
        if (dataHistory.length > 50) dataHistory.shift();
        
        console.log(`[${timeStr}] Đã lưu dữ liệu từ ESP32: Nhiệt độ ${payload.temp}°C`);
    } catch (error) {
        console.error("⚠️ Lỗi phân giải JSON:", error);
    }
});

// 2. API CUNG CẤP LỊCH SỬ CHO TRANG WEB (KHI VỪA MỞ LÊN)
app.get('/api/data', (req, res) => {
    res.json(dataHistory);
});

// Khởi chạy máy chủ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Máy chủ đang chạy tại Port ${PORT}`);
});
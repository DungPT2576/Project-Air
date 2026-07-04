const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json()); // Bắt buộc phải có để đọc được file JSON gửi bù

// Phục vụ giao diện web tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

let dataHistory = []; // Bộ nhớ đệm RAM lưu tối đa 50 điểm

// ==========================================
// 1. KẾT NỐI SERVER VỚI MQTT BROKER (LUỒNG REAL-TIME)
// ==========================================
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com:1883');
const myTopic = 'airsense/hust/tiendung_2507'; // Đã đồng bộ Topic mới

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

// ==========================================
// 2. API ĐỒNG BỘ DỮ LIỆU TỒN ĐỌNG TỪ THẺ SD CARD
// ==========================================
app.post('/api/sync', (req, res) => {
    try {
        const payload = req.body;
        
        // Phân tách timestamp do ESP32 truyền lên (ví dụ: "27/6 16:53:15")
        const parts = payload.timestamp.split(' ');
        
        const syncData = {
            pm25: parseFloat(payload.pm25),
            pm10: parseFloat(payload.pm10),
            temp: parseFloat(payload.temp),
            hum: parseFloat(payload.hum),
            timeLabel: parts[1] || '00:00:00', // Lấy chuỗi Giờ:Phút:Giây cũ
            dateLabel: parts[0] || '1/1'        // Lấy chuỗi Ngày/Tháng cũ
        };

        // Đẩy vào mảng lưu trữ lịch sử trên RAM
        dataHistory.push(syncData);
        if (dataHistory.length > 50) dataHistory.shift();

        console.log(`📥 [ĐỒNG BỘ BÙ] Đã nhận dữ liệu cũ của mốc thời gian: [${payload.timestamp}]`);
        res.status(200).send("OK");
    } catch (error) {
        console.error("⚠️ Lỗi xử lý gói đồng bộ:", error);
        res.status(500).send("Error");
    }
});

// ==========================================
// 3. API CUNG CẤP LỊCH SỬ CHO TRANG WEB KHI VỪA MỞ LÊN
// ==========================================
app.get('/api/data', (req, res) => {
    res.json(dataHistory);
});

// Khởi chạy máy chủ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Máy chủ đang chạy tại Port ${PORT}`);
});
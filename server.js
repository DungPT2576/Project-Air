const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
// Tăng giới hạn JSON để nhận lô dữ liệu lớn từ ESP32
app.use(express.json({ limit: '5mb' })); 
app.use(express.static(path.join(__dirname, 'public')));

// 1. KẾT NỐI MONGODB
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dungpt2414986:Dungd0vd%23@airproject.arxmcfi.mongodb.net/?appName=AirProject";
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 45000 })
    .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
    .catch(err => console.error('⚠️ Lỗi MongoDB:', err.message));

const dataSchema = new mongoose.Schema({
    pm25: Number, pm10: Number, temp: Number, hum: Number,
    timeLabel: String, dateLabel: String,
    createdAt: { type: Date, default: Date.now } 
});
const SensorData = mongoose.model('SensorData', dataSchema);

// 2. API NHẬN DỮ LIỆU BATCH (XỬ LÝ THEO LÔ TỪ ESP32)
app.post('/api/sync', async (req, res) => {
    try {
        const payloadArray = req.body; // ESP32 sẽ gửi lên 1 mảng JSON chứa nhiều bản ghi
        if (!Array.isArray(payloadArray) || payloadArray.length === 0) {
            return res.status(400).send("Dữ liệu không hợp lệ");
        }

        // Chuyển đổi định dạng và lưu toàn bộ lô dữ liệu vào MongoDB trong 1 lệnh duy nhất
        const docsToInsert = payloadArray.map(item => {
            const parts = item.timestamp.split(' ');
            return {
                pm25: parseFloat(item.pm25),
                pm10: parseFloat(item.pm10),
                temp: parseFloat(item.temp),
                hum: parseFloat(item.hum),
                timeLabel: parts[1] || '00:00:00',
                dateLabel: parts[0] || '1/1/2026'
            };
        });

        await SensorData.insertMany(docsToInsert);
        console.log(`✅ [SD SYNC] Đã lưu thành công lô ${docsToInsert.length} bản ghi vào DB.`);
        
        res.status(200).send("OK");
    } catch (error) {
        console.error("Lỗi khi lưu Batch DB:", error.message);
        res.status(500).send("Error");
    }
});

// 3. API LẤY LỊCH SỬ KHI MỞ WEB VÀ POLLING
app.get('/api/data', async (req, res) => {
    try {
        const history = await SensorData.find().sort({ createdAt: -1 }).limit(50);
        res.json(history.reverse());
    } catch (error) {
        res.status(500).json([]); 
    }
});

// 4. API KIỂM TRA TRẠNG THÁI (PING)
app.get('/api/ping', (req, res) => {
    res.status(200).send("Server is awake!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy thuần HTTP tại Port ${PORT}`));
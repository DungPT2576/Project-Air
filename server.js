const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let sensorData = [];

app.post('/api/data', (req, res) => {
    const { pm25, pm10, temp, hum } = req.body;
    
    if (pm25 != null && pm10 != null && temp != null && hum != null) {
        const newData = {
            timestamp: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            pm25: pm25,
            pm10: pm10,
            temp: temp,
            hum: hum
        };
        
        sensorData.push(newData);
        
        if (sensorData.length > 50) {
            sensorData.shift();
        }
        
        console.log("Data received:", newData);
        res.status(200).send("OK");
    } else {
        res.status(400).send("Bad Request");
    }
});

app.get('/api/data', (req, res) => {
    res.json(sensorData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
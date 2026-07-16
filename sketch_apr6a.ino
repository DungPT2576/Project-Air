#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <SDS011.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPClient.h> 
#include <ArduinoJson.h>
#include <SPI.h>
#include <SD.h>         
#include <time.h>       

// ====================================================================
// KHAI BÁO CẤU HÌNH HỆ THỐNG
// ====================================================================
const char* ssid        = "TP-Link_0888";      
const char* password    = "36162604";         
const char* mqtt_server = "broker.emqx.io";
const char* mqtt_topic  = "airsense/hust/tiendung_2507"; 
const char* server_url  = "https://project-air-d87x.onrender.com/api/sync"; 
const char* ping_url    = "https://project-air-d87x.onrender.com/api/ping"; // API kiểm tra máy chủ

const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 25200; 
const int   daylightOffset_sec = 0;

#define SDS_RX 16  
#define SDS_TX 4   
#define SD_CS  5 

Adafruit_SHT31 sht30 = Adafruit_SHT31();
SDS011 my_sds;
WiFiClient espClient;
PubSubClient client(espClient);

float p10, p25;
bool isTimeSynced = false; 

// Biến đánh số thứ tự (ID) cho dữ liệu
uint32_t dataID = 1; 

// ====================================================================
// HÀM KIỂM TRA TRẠNG THÁI MÁY CHỦ RENDER
// ====================================================================
bool isServerAwake() {
  if (WiFi.status() != WL_CONNECTED) return false;
  
  HTTPClient http;
  http.begin(ping_url); 
  http.setTimeout(5000); // Đợi tối đa 5 giây
  
  int httpCode = http.GET();
  http.end();
  
  if (httpCode == 200) {
    return true; 
  } else {
    return false; 
  }
}

// ====================================================================
// HÀM KẾT NỐI MẠNG
// ====================================================================
void setup_wifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Đang kết nối Wi-Fi...");
  WiFi.begin(ssid, password);
  int counter = 0;
  while (WiFi.status() != WL_CONNECTED && counter < 20) { 
    delay(500); Serial.print("."); 
    counter++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" ✅ Wi-Fi Connected!");
    if (!isTimeSynced) {
      configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
      isTimeSynced = true;
    }
  } else {
    Serial.println(" ❌ Wi-Fi Timeout (Offline)");
  }
}

void reconnect() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!client.connected()) {
    String clientId = "ESP32Client-" + String(random(0, 0xffff), HEX);
    client.connect(clientId.c_str());
  }
}

// ====================================================================
// HÀM LƯU DỮ LIỆU KÉP (MASTER & QUEUE)
// ====================================================================
void logDataToSD(String timestamp, float temp, float hum, float pm25, float pm10, bool isOffline) {
  File masterFile = SD.open("/datalog.csv", FILE_APPEND);
  if (masterFile) {
    masterFile.printf("%d,%s,%.2f,%.2f,%.2f,%.2f\n", dataID, timestamp.c_str(), temp, hum, pm25, pm10);
    masterFile.close();
    Serial.printf("📊 Đã lưu ID %d vào sổ cái datalog.csv\n", dataID);
  } else {
    Serial.println("❌ Lỗi mở datalog.csv");
  }

  if (isOffline) {
    File pendingFile = SD.open("/pending.txt", FILE_APPEND);
    if (pendingFile) {
      pendingFile.printf("%d|%s|%.2f|%.2f|%.2f|%.2f\n", dataID, timestamp.c_str(), temp, hum, pm25, pm10);
      pendingFile.close();
      Serial.println("⚠️ Đã copy vào hàng đợi gửi bù pending.txt");
    }
  }
  dataID++; 
}

// ====================================================================
// HÀM ĐỒNG BỘ DỮ LIỆU TỒN ĐỌNG TỪ HÀNG ĐỢI
// ====================================================================
void syncOfflineData() {
  if (!SD.exists("/pending.txt")) return;
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("🔄 Phát hiện hàng đợi pending.txt! Bắt đầu đồng bộ...");
  File dataFile = SD.open("/pending.txt", FILE_READ);
  if (!dataFile) return;

  bool syncSuccess = true;

  while (dataFile.available()) {
    String line = dataFile.readStringUntil('\n');
    if (line.length() < 10) continue;

    int idx0 = line.indexOf('|'); 
    int idx1 = line.indexOf('|', idx0 + 1);
    int idx2 = line.indexOf('|', idx1 + 1);
    int idx3 = line.indexOf('|', idx2 + 1);
    int idx4 = line.indexOf('|', idx3 + 1);

    String t_stub = line.substring(idx0 + 1, idx1);
    float temp    = line.substring(idx1 + 1, idx2).toFloat();
    float hum     = line.substring(idx2 + 1, idx3).toFloat();
    float pm25    = line.substring(idx3 + 1, idx4).toFloat();
    float pm10    = line.substring(idx4 + 1).toFloat();

    StaticJsonDocument<200> doc;
    doc["timestamp"] = t_stub; 
    doc["temp"] = temp;
    doc["hum"] = hum;
    doc["pm25"] = pm25;
    doc["pm10"] = pm10;

    String jsonPayload;
    serializeJson(doc, jsonPayload);

    HTTPClient http;
    http.begin(server_url);
    http.addHeader("Content-Type", "application/json");
    
    int httpResponseCode = http.POST(jsonPayload);
    http.end();

    if (httpResponseCode != 200) {
      syncSuccess = false; 
      break; 
    }
    delay(100); 
  }
  dataFile.close();

  if (syncSuccess) {
    SD.remove("/pending.txt"); 
    Serial.println("🎉 Đã gửi bù xong! Xóa hàng đợi tạm thời.");
  }
}

// ====================================================================
// HÀM KHỞI TẠO HỆ THỐNG
// ====================================================================
void setup() {
  Serial.begin(115200);
  Wire.begin(22, 21); 
  
  if (!sht30.begin(0x44)) Serial.println("❌ Không tìm thấy SHT30");
  my_sds.begin(&Serial2, SDS_RX, SDS_TX); 

  if (!SD.begin(SD_CS)) {
    Serial.println("❌ Kết nối thẻ SD thất bại!");
  } else {
    Serial.println("✅ Thẻ SD đã sẵn sàng!");
    if (!SD.exists("/datalog.csv")) {
      File masterFile = SD.open("/datalog.csv", FILE_WRITE);
      masterFile.println("ID,Timestamp,Temp(C),Humidity(%),PM2.5,PM10");
      masterFile.close();
    }
  }

  setup_wifi();
  client.setServer(mqtt_server, 1883);
}

// ====================================================================
// VÒNG LẶP HOẠT ĐỘNG CHÍNH (CHU KỲ 5 PHÚT)
// ====================================================================
void loop() {
  Serial.println("\n=====================================");
  Serial.println("1. ĐÁNH THỨC CẢM BIẾN BỤI MỊN SDS011");
  my_sds.wakeup(); 
  
  Serial.println("2. LÀM NÓNG (WARM-UP) TRONG 1 PHÚT...");
  delay(60000); 

  Serial.println("3. ĐỌC DỮ LIỆU CẢM BIẾN");
  int err = my_sds.read(&p25, &p10);
  float temp = sht30.readTemperature();
  float hum = sht30.readHumidity();

  Serial.println("4. ĐƯA CẢM BIẾN SDS011 VÀO CHẾ ĐỘ NGỦ (SLEEP)");
  my_sds.sleep(); 

  // Lấy mốc thời gian chuẩn
  struct tm timeinfo;
  char timeBuffer[20];
  char dateBuffer[10];
  if(!getLocalTime(&timeinfo)){
    sprintf(timeBuffer, "00:00:00");
    sprintf(dateBuffer, "1/1");
  } else {
    strftime(timeBuffer, sizeof(timeBuffer), "%H:%M:%S", &timeinfo);
    strftime(dateBuffer, sizeof(dateBuffer), "%d/%m", &timeinfo);
  }
  String fullTimestamp = String(dateBuffer) + " " + String(timeBuffer);

  Serial.println("5. KIỂM TRA MẠNG VÀ TRẠNG THÁI MÁY CHỦ RENDER...");
  setup_wifi(); // Đảm bảo Wi-Fi kết nối lại sau khi ngủ dậy
  
  bool serverReady = false;
  if (WiFi.status() == WL_CONNECTED) {
    serverReady = isServerAwake();
  }

  if (!err) {
    if (serverReady) {
      Serial.println("-> Server đang thức! Bắt đầu đồng bộ và gửi dữ liệu...");
      if (!client.connected()) reconnect();
      client.loop();
      
      syncOfflineData(); 
      
      StaticJsonDocument<200> doc;
      doc["pm25"] = p25;
      doc["pm10"] = p10;
      doc["temp"] = temp;
      doc["hum"] = hum;
      String jsonString;
      serializeJson(doc, jsonString);
      
      client.publish(mqtt_topic, jsonString.c_str());
      logDataToSD(fullTimestamp, temp, hum, p25, p10, false); 
    } else {
      Serial.println("-> Server NGỦ hoặc MẤT MẠNG! Chỉ ghi vào thẻ nhớ...");
      logDataToSD(fullTimestamp, temp, hum, p25, p10, true); 
    }
  } else {
    Serial.println("❌ Lỗi không đọc được cảm biến SDS011");
  }

  Serial.println("6. ESP32 CHUYỂN SANG CHẾ ĐỘ LIGHT SLEEP TRONG 4 PHÚT...");
  // Kích hoạt hẹn giờ đánh thức sau 4 phút (240.000.000 micro-giây)
  esp_sleep_enable_timer_wakeup(240000000ULL); 
  esp_light_sleep_start(); 
}
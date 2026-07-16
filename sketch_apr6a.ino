#include <Wire.h>
#include <Adafruit_SHT31.h>
#include <SDS011.h>
#include <WiFi.h>
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
const char* server_url  = "https://project-air-d87x.onrender.com/api/sync"; 
const char* ping_url    = "https://project-air-d87x.onrender.com/api/ping"; 

const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 25200; 
const int   daylightOffset_sec = 0;

#define SDS_RX 16  
#define SDS_TX 4   
#define SD_CS  5 

Adafruit_SHT31 sht30 = Adafruit_SHT31();
SDS011 my_sds;

float p10, p25;
bool isTimeSynced = false; 

// Biến đánh số thứ tự (ID) cho dữ liệu
uint32_t dataID = 1; 

// ====================================================================
// HÀM KIỂM TRA MÁY CHỦ (PING) VÀ THỜI GIAN THỰC
// ====================================================================
bool isServerAwake() {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(ping_url); 
  http.setTimeout(5000); 
  int httpCode = http.GET();
  http.end();
  return (httpCode == 200);
}

String getTimestamp() {
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
  return String(dateBuffer) + " " + String(timeBuffer);
}

// ====================================================================
// HÀM KẾT NỐI MẠNG (TỐI ƯU HÓA)
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
    Serial.println(" ✅ Connected!");
    if (!isTimeSynced) {
      configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
      isTimeSynced = true;
    }
  } else {
    Serial.println(" ❌ Offline");
  }
}

// ====================================================================
// HÀM LƯU DỮ LIỆU ĐỒNG THỜI VÀO SỔ CÁI & HÀNG ĐỢI
// ====================================================================
void logDataToSD(String timestamp, float temp, float hum, float pm25, float pm10) {
  // 1. Luôn lưu vào sổ cái vĩnh viễn
  File masterFile = SD.open("/datalog.csv", FILE_APPEND);
  if (masterFile) {
    masterFile.printf("%d,%s,%.2f,%.2f,%.2f,%.2f\n", dataID, timestamp.c_str(), temp, hum, pm25, pm10);
    masterFile.close();
  } else {
    Serial.println("❌ Lỗi mở datalog.csv");
  }

  // 2. Luôn nạp vào hàng đợi để chuẩn bị đóng gói (Batch)
  File pendingFile = SD.open("/pending.txt", FILE_APPEND);
  if (pendingFile) {
    pendingFile.printf("%d|%s|%.2f|%.2f|%.2f|%.2f\n", dataID, timestamp.c_str(), temp, hum, pm25, pm10);
    pendingFile.close();
  }
  dataID++; 
}

// ====================================================================
// HÀM ĐÓNG GÓI JSON & GỬI THEO LÔ (BATCH)
// ====================================================================
void syncOfflineDataBatch() {
  if (!SD.exists("/pending.txt")) return;
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("🔄 Đang đóng gói dữ liệu pending.txt để gửi lô...");
  File dataFile = SD.open("/pending.txt", FILE_READ);
  if (!dataFile) return;

  // Tạo tài liệu JSON động (Kích thước lớn để chứa mảng nhiều phần tử)
  DynamicJsonDocument doc(4096);
  JsonArray array = doc.to<JsonArray>();

  int recordCount = 0;
  while (dataFile.available()) {
    String line = dataFile.readStringUntil('\n');
    if (line.length() < 10) continue;

    int idx0 = line.indexOf('|'); 
    int idx1 = line.indexOf('|', idx0 + 1);
    int idx2 = line.indexOf('|', idx1 + 1);
    int idx3 = line.indexOf('|', idx2 + 1);
    int idx4 = line.indexOf('|', idx3 + 1);

    JsonObject obj = array.createNestedObject();
    obj["timestamp"] = line.substring(idx0 + 1, idx1);
    obj["temp"]      = line.substring(idx1 + 1, idx2).toFloat();
    obj["hum"]       = line.substring(idx2 + 1, idx3).toFloat();
    obj["pm25"]      = line.substring(idx3 + 1, idx4).toFloat();
    obj["pm10"]      = line.substring(idx4 + 1).toFloat();
    
    recordCount++;
  }
  dataFile.close();

  if (recordCount == 0) return;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  // Bắn 1 phát duy nhất lên Server
  HTTPClient http;
  http.begin(server_url);
  http.addHeader("Content-Type", "application/json");
  
  int httpResponseCode = http.POST(jsonPayload);
  http.end();

  if (httpResponseCode == 200) {
    SD.remove("/pending.txt"); 
    Serial.printf("🎉 Đã gửi thành công lô %d bản ghi! Xóa hàng đợi.\n", recordCount);
  } else {
    Serial.printf("⚠️ Gửi lô thất bại (Mã lỗi: %d). Giữ lại thẻ nhớ chờ lần sau.\n", httpResponseCode);
  }
}

// ====================================================================
// HÀM KHỞI TẠO (SETUP)
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
}

// ====================================================================
// VÒNG LẶP HOẠT ĐỘNG CHÍNH (TỔNG CHU KỲ 5 PHÚT)
// ====================================================================
void loop() {
  Serial.println("\n=====================================");
  Serial.println("--- BẮT ĐẦU CHU KỲ MỚI (5 PHÚT) ---");
  
  // 1. LÀM NÓNG CẢM BIẾN (30 GIÂY)
  Serial.println("1. Đánh thức SDS011 và làm nóng 30 giây...");
  my_sds.wakeup(); 
  delay(30000); 

  // 2. ĐO LIÊN TỤC TRONG 1 PHÚT (12 MẪU, CÁCH NHAU 5S)
  Serial.println("2. Bắt đầu đo 12 mẫu liên tục (1 phút)...");
  setup_wifi(); // Cập nhật giờ RTC trước khi đo
  
  for (int i = 0; i < 12; i++) {
    int err = my_sds.read(&p25, &p10);
    float temp = sht30.readTemperature();
    float hum = sht30.readHumidity();

    if (!err) {
      String timestamp = getTimestamp();
      logDataToSD(timestamp, temp, hum, p25, p10);
      Serial.printf("   + Mẫu %d: T=%.1f C, H=%.1f %%, PM2.5=%.1f\n", i+1, temp, hum, p25);
    } else {
      Serial.println("   + Lỗi đọc SDS011");
    }
    
    // Nếu chưa phải mẫu cuối thì đợi 5s
    if (i < 11) delay(5000); 
  }

  // 3. ĐƯA SDS011 VÀO CHẾ ĐỘ NGỦ BẢO VỆ LASER
  Serial.println("3. Đưa cảm biến SDS011 vào chế độ ngủ (SLEEP)...");
  my_sds.sleep(); 

  // 4. KIỂM TRA MẠNG VÀ GỬI LÔ DỮ LIỆU
  Serial.println("4. Kiểm tra Mạng & Trạng thái Server...");
  setup_wifi(); 
  bool serverReady = (WiFi.status() == WL_CONNECTED) ? isServerAwake() : false;

  if (serverReady) {
    Serial.println("-> Server Tỉnh! Đang gửi lô dữ liệu lên Web...");
    syncOfflineDataBatch(); 
  } else {
    Serial.println("-> Mất mạng/Server Ngủ! Dữ liệu đã được bảo lưu trong thẻ nhớ.");
  }

  // 5. NGỦ ĐÔNG ESP32 (210 GIÂY = 3 PHÚT 30 GIÂY)
  Serial.println("5. ESP32 Light Sleep trong 3 phút 30 giây...");
  esp_sleep_enable_timer_wakeup(210000000ULL); // 210 giây tính bằng micro-giây
  esp_light_sleep_start(); 
}
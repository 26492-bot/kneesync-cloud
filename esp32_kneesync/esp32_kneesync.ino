#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "V";
const char* password = "11111111";

// Replace with your server URL
const char* serverUrl = "http://192.168.112.95/api/ingest"; 
const char* deviceId = "ESP32_KNEE_004";

void setup() {
  Serial.begin(115200);
  
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // Replace these with actual sensor readings
    float currentKneeAngle = 58.5; 
    float currentTiltAngle = 2.1;
    float currentTremor = 0.05;

    StaticJsonDocument<200> doc;
    doc["device_id"] = deviceId;
    doc["knee_angle"] = currentKneeAngle;
    doc["tilt_angle"] = currentTiltAngle;
    doc["tremor_rms"] = currentTremor;
    doc["gait_phase"] = "Stance";

    String requestBody;
    serializeJson(doc, requestBody);

    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println(httpResponseCode);
      Serial.println(response);
    } else {
      Serial.print("Error on sending POST: ");
      Serial.println(httpResponseCode);
    }

    http.end();
  } else {
    Serial.println("Error in WiFi connection");
  }

  // Delay before next step/reading
  delay(1000); 
}

#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <UniversalTelegramBot.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <ESP_Mail_Client.h>
#include <TinyGPSPlus.h>
#include <esp_task_wdt.h>
#include <math.h>
#include <LiquidCrystal.h>

// ============================================================
// CREDENTIALS  (keep this file private - never share or upload it)
// ============================================================
#define WIFI_SSID_1  "vivo"
#define WIFI_PASS_1  "123456789"
#define WIFI_SSID_2  "Pritesh_Patil"        // second network (set "" to disable)
#define WIFI_PASS_2  "patil123"

#define AP_SSID      "SmartHelmet"          // fallback hotspot if no WiFi -> http://192.168.4.1
#define AP_PASS      "helmet1234"           // at least 8 characters

#define BOT_TOKEN    "8850517054:AAFjJre9lHDiBBJrjow7m1w5xGf8jfzMPDg"
#define CHAT_ID      "8479334875"

#define SENDER_EMAIL    "ptspfl3@gmail.com"
#define SENDER_PASSWORD "cmgc zgxm irzb qjys"

#define FIREBASE_API_KEY      "AIzaSyCn_xSXw-wK9l8tNxEAYVybjHKZQ04AnGk"
#define FIREBASE_DATABASE_URL "https://smart-helmet-by-prtesh-patil-default-rtdb.firebaseio.com"

#define HELMET_PIN   "8767"

#define ENABLE_USER_AUTH
#define ENABLE_DATABASE
#include <FirebaseClient.h>

enum HelmetState : uint8_t
{
  ST_VERIFY, ST_WARMUP, ST_PRESTART, ST_RIDING,
  ST_ALCOHOL_WARN, ST_ACC_COUNTDOWN, ST_ACC_ALERT
};

HelmetState helmetState = ST_VERIFY;

// ---------------- optional hardware ----------------
#define ENABLE_WEAR_SENSOR   0     // 1 = chin-strap switch between WEAR_PIN and GND (LOW = worn)
#define TELEGRAM_VERIFY_TLS  0     // 1 = verify Telegram cert (needs correct time + valid root CA)

// ---------------- pins ----------------
const int ALCOHOL_PIN = 34;   // MQ-3 AO  -> MUST go through a 5V->3.3V divider (e.g. 10k/20k)!
const int BUZZER_PIN  = 25;
const int RELAY_PIN   = 26;
const int GPS_RX_PIN  = 16;
const int GPS_TX_PIN  = 17;
const int CANCEL_PIN  = 32;   // button to GND
const int SOS_PIN     = 27;   // button to GND (hold 3 s)
const int WEAR_PIN    = 14;
const int ACCEL_X_PIN = 35;
const int ACCEL_Y_PIN = 33;
const int ACCEL_Z_PIN = 36;

// =====================================================
// JHD162A 16x2 LCD - 4 BIT PARALLEL MODE
// =====================================================
const int LCD_RS = 4;
const int LCD_E  = 5;
const int LCD_D4 = 18;
const int LCD_D5 = 19;
const int LCD_D6 = 21;
const int LCD_D7 = 22;

LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);

unsigned long lcdLastUpdate = 0;
unsigned long lcdNextPageAt = 0;
uint8_t lcdPage = 0;
int lcdLastState = -1;

// Forward declarations
int stateSecondsLeft();
extern bool alcoholDetected;
extern int alcoholPercent;
extern int accelImpact;
extern double gpsSpeedKmph;
extern bool gpsSpeedValid;
extern uint8_t gpsSats;
extern volatile bool manualSos;

void lcdLine(uint8_t row, const String& text)
{
  String s = text;
  if (s.length() > 16) s = s.substring(0, 16);
  while (s.length() < 16) s += ' ';
  lcd.setCursor(0, row);
  lcd.print(s);
}

void updateLCD()
{
  const unsigned long LCD_UPDATE_MS = 400;
  const unsigned long LCD_PAGE_MS   = 2200;

  unsigned long now = millis();
  if (now - lcdLastUpdate < LCD_UPDATE_MS) return;
  lcdLastUpdate = now;

  if ((int)helmetState != lcdLastState)
  {
    lcdLastState = (int)helmetState;
    lcdPage = 0;
    lcdNextPageAt = now + LCD_PAGE_MS;
    lcd.clear();
  }
  else if (helmetState == ST_RIDING && now >= lcdNextPageAt)
  {
    lcdPage = (lcdPage + 1) % 3;
    lcdNextPageAt = now + LCD_PAGE_MS;
    lcd.clear();
  }

  switch (helmetState)
  {
    case ST_VERIFY:
      lcdLine(0, "SMART HELMET");
      lcdLine(1, "ENTER PIN");
      break;

    case ST_WARMUP:
      lcdLine(0, "SYSTEM WARMUP");
      lcdLine(1, "WAIT " + String(stateSecondsLeft()) + " SEC");
      break;

    case ST_PRESTART:
      if (alcoholDetected)
      {
        lcdLine(0, "ALCOHOL ALERT");
        lcdLine(1, "MOTOR LOCKED");
      }
      else
      {
        lcdLine(0, "SAFETY CHECK OK");
        lcdLine(1, "MOTOR READY");
      }
      break;

    case ST_RIDING:
    {
      switch (lcdPage)
      {
        case 0:
          lcdLine(0, "SPD: " + String(gpsSpeedKmph, 1) + " KM/H");
          lcdLine(1, gpsSpeedValid ? ("FIX OK SAT:" + String(gpsSats)) : "GPS WAITING...");
          break;

        case 1:
          lcdLine(0, "ALCOHOL " + String(alcoholPercent) + "%");
          lcdLine(1, alcoholDetected ? "DANGER" : "SAFE MOTOR ON");
          break;

        default:
          lcdLine(0, "IMPACT " + String(accelImpact));
          lcdLine(1, "GPS SAT " + String(gpsSats));
          break;
      }
      break;
    }

    case ST_ALCOHOL_WARN:
      lcdLine(0, "ALCOHOL WARNING");
      lcdLine(1, "STOP IN " + String(stateSecondsLeft()) + " SEC");
      break;

    case ST_ACC_COUNTDOWN:
      lcdLine(0, "ACCIDENT ALERT!");
      lcdLine(1, "CANCEL " + String(stateSecondsLeft()) + " SEC");
      break;

    case ST_ACC_ALERT:
      if (manualSos)
      {
        lcdLine(0, "MANUAL SOS!");
        lcdLine(1, "HELP ALERT SENT");
      }
      else
      {
        lcdLine(0, "ACCIDENT SENT!");
        lcdLine(1, "GPS ALERT ACTIVE");
      }
      break;
  }
}

// ---------------- timings ----------------
const unsigned long WARMUP_MS          = 2000;
const unsigned long PRESTART_CLEAR_MS  = 3000;
const unsigned long ALCOHOL_WARN_MS    = 15000;
const unsigned long ACCIDENT_CANCEL_MS = 15000;
const unsigned long CANCEL_HOLD_MS     = 800;
const unsigned long SOS_HOLD_MS        = 3000;
const unsigned long LOC_UPDATE_MS      = 30000;
const uint8_t       LOC_UPDATE_MAX     = 10;
const unsigned long ARM_DELAY_MS       = 2000;
const unsigned long ALCOHOL_NOTIFY_GAP = 30000;
const unsigned long WEAR_LOSS_MS       = 5000;
const unsigned long SENSOR_INTERVAL    = 20;

const uint8_t  MAX_PIN_TRIES   = 5;
const unsigned long PIN_LOCKOUT_MS = 60000;
const unsigned long PIN_POLL_MS    = 2000;
const unsigned long CMD_POLL_MS    = 5000;
const unsigned long PROMPT_RETRY_MS = 15000;

const uint8_t TELEGRAM_RETRIES = 3;
const uint8_t EMAIL_RETRIES    = 2;

// =====================================================
// SHARED STATE / HELPERS
// =====================================================

unsigned long stateSince = 0;
unsigned long clearSince = 0;
volatile bool resetRequested = false;
volatile bool verifyRequested = false;
volatile bool verifyPromptSent = false;
volatile bool notificationBusy = false;
volatile bool telegramLastOk = true;
volatile bool manualSos = false;
bool accidentDetected = false;
bool apMode = false;

uint8_t locUpdatesSent = 0;
unsigned long lastLocUpdate = 0;
bool alcoholWhileRiding = false;
unsigned long lastAlcoholNotify = 0;
unsigned long wornLostSince = 0;
bool promptTried = false;
unsigned long lastPromptTry = 0;

SemaphoreHandle_t cfgMutex = NULL;
portMUX_TYPE pinMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE gpsMux = portMUX_INITIALIZER_UNLOCKED;
portMUX_TYPE logMux = portMUX_INITIALIZER_UNLOCKED;

// ---- tiny JSON builder ----
struct Json
{
  String s;
  bool first = true;
  Json() { s.reserve(1700); s = "{"; }
  void key(const char* k) { if (!first) s += ','; first = false; s += '"'; s += k; s += "\":"; }
  void i(const char* k, long v)          { key(k); s += String(v); }
  void u(const char* k, uint32_t v)      { key(k); s += String((unsigned long)v); }
  void f(const char* k, double v, int d) { key(k); s += String(v, (unsigned int)d); }
  void b(const char* k, bool v)          { key(k); s += v ? "true" : "false"; }
  void raw(const char* k, const String& v) { key(k); s += v; }
  void str(const char* k, const String& v)
  {
    key(k); s += '"';
    for (size_t n = 0; n < v.length(); n++)
    {
      char c = v[n];
      if (c == '"' || c == '\\') { s += '\\'; s += c; }
      else if ((uint8_t)c >= 0x20) s += c;
    }
    s += '"';
  }
  String done() { s += '}'; return s; }
};

// ---- event log ----
const uint8_t LOG_SIZE = 12;
struct LogEntry { uint32_t t; char msg[56]; };
LogEntry logBuf[LOG_SIZE];
uint8_t logNext = 0, logCount = 0;

void logEvent(const char* fmt, ...)
{
  char tmp[56];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(tmp, sizeof(tmp), fmt, ap);
  va_end(ap);

  Serial.print("[LOG] ");
  Serial.println(tmp);

  portENTER_CRITICAL(&logMux);
  logBuf[logNext].t = millis() / 1000;
  strlcpy(logBuf[logNext].msg, tmp, sizeof(logBuf[0].msg));
  logNext = (logNext + 1) % LOG_SIZE;
  if (logCount < LOG_SIZE) logCount++;
  portEXIT_CRITICAL(&logMux);
}

String logJson()
{
  LogEntry copy[LOG_SIZE];
  uint8_t n, next;

  portENTER_CRITICAL(&logMux);
  memcpy(copy, logBuf, sizeof(copy));
  n = logCount;
  next = logNext;
  portEXIT_CRITICAL(&logMux);

  String s = "[";
  for (uint8_t k = 0; k < n; k++)
  {
    uint8_t idx = (next + LOG_SIZE - 1 - k) % LOG_SIZE;
    if (k) s += ',';
    s += "{\"t\":";
    s += String(copy[idx].t);
    s += ",\"m\":\"";
    for (const char* p = copy[idx].msg; *p; p++)
      if (*p != '"' && *p != '\\' && (uint8_t)*p >= 0x20) s += *p;
    s += "\"}";
  }
  s += "]";
  return s;
}

WiFiClientSecure telegramClient;
UniversalTelegramBot bot(BOT_TOKEN, telegramClient);

WiFiClientSecure firebaseSSL;
using FirebaseAsyncClient = AsyncClientClass;
FirebaseAsyncClient firebaseClient(firebaseSSL);
NoAuth firebaseNoAuth;
FirebaseApp firebaseApp;
RealtimeDatabase firebaseDatabase;

bool firebaseInitStarted = false;
bool firebaseReady = false;
unsigned long lastFirebaseLive = 0, lastFirebaseHistory = 0, lastHeapReport = 0;

const unsigned long FIREBASE_LIVE_MS    = 1000;
const unsigned long FIREBASE_HISTORY_MS = 10000;
const uint8_t  FIREBASE_MAX_PENDING = 2;
const size_t   FIREBASE_MIN_FREE_HEAP = 25000;

volatile uint8_t firebasePending = 0;
unsigned long firebasePendingSince = 0;
volatile bool firebaseAlcoholEventPending = false;
volatile bool firebaseAccidentEventPending = false;

SMTPSession smtp;
ESP_Mail_Session mailSession;

TinyGPSPlus gps;
WebServer server(80);
Preferences preferences;

String recipientEmail = "";
volatile bool emailEnabled = false;

// =====================================================
// PIN
// =====================================================

uint8_t pinFails = 0;
unsigned long pinLockUntil = 0;

int checkPin(const String& pin)
{
  int result;
  portENTER_CRITICAL(&pinMux);
  unsigned long now = millis();

  if (pinLockUntil != 0 && (long)(pinLockUntil - now) > 0)
    result = -1;
  else if (pin == HELMET_PIN)
  {
    pinFails = 0;
    verifyRequested = true;
    result = 1;
  }
  else
  {
    pinFails++;
    if (pinFails >= MAX_PIN_TRIES)
    {
      pinFails = 0;
      pinLockUntil = now + PIN_LOCKOUT_MS;
      result = -1;
    }
    else result = 0;
  }
  portEXIT_CRITICAL(&pinMux);
  return result;
}

bool isDigitsOnly(const String& s)
{
  if (s.length() < 4 || s.length() > 8) return false;
  for (size_t i = 0; i < s.length(); i++)
    if (!isDigit(s[i])) return false;
  return true;
}

// =====================================================
// RELAY
// =====================================================

const bool RELAY_ACTIVE_LOW = true;
int relayState = -1;

void relayOn()
{
  if (relayState == 1) return;
  relayState = 1;
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? LOW : HIGH);
}

void relayOff()
{
  if (relayState == 0) return;
  relayState = 0;
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);
}

// =====================================================
// ALCOHOL (MQ-3)
// =====================================================

const int ALCOHOL_THRESHOLD = 1800;
const uint8_t DETECT_CONFIRM_COUNT = 3;
const uint8_t CLEAR_CONFIRM_COUNT  = 5;

int alcoholRaw = 0, alcoholPercent = 0;
bool alcoholDetected = false, previousAlcoholState = false;
uint8_t highCount = 0, lowCount = 0;

void readAlcoholSensor()
{
  uint32_t sum = 0;
  for (uint8_t i = 0; i < 8; i++) sum += analogRead(ALCOHOL_PIN);
  alcoholRaw = sum / 8;
  alcoholPercent = constrain(map(alcoholRaw, 0, 4095, 0, 100), 0, 100);

  if (alcoholRaw >= ALCOHOL_THRESHOLD)
  {
    lowCount = 0;
    if (highCount < DETECT_CONFIRM_COUNT) highCount++;
    if (highCount >= DETECT_CONFIRM_COUNT) alcoholDetected = true;
  }
  else
  {
    highCount = 0;
    if (lowCount < CLEAR_CONFIRM_COUNT) lowCount++;
    if (lowCount >= CLEAR_CONFIRM_COUNT) alcoholDetected = false;
  }
}

// =====================================================
// ACCIDENT DETECTION (ADXL335)
// =====================================================

//                                      1=LOW  2=MEDIUM  3=HIGH
const int ACCEL_PRESET_IMPACT[3] = {  1100,     850,     600 };
const int ACCEL_PRESET_JERK[3]   = {   650,     450,     320 };
const uint32_t ACCEL_WINDOW_MS   = 60;
const float ACCEL_HEAVY_FACTOR      = 1.8f;
const float ACCEL_HEAVY_JERK_FACTOR = 0.7f;

const uint32_t ACCEL_SAMPLE_MS  = 10;
const uint32_t ACCEL_MAX_GAP_MS = 30;
const uint8_t  ACCEL_CONFIRM_SAMPLES = 2;

uint8_t accelSensitivity = 2;
int accelImpactThr = 850, accelJerkThr = 450;
int accelStableImpact = 300, accelStableJerk = 180;

void applySensitivity(uint8_t level)
{
  level = constrain(level, 1, 3);
  accelSensitivity = level;
  accelImpactThr = ACCEL_PRESET_IMPACT[level - 1];
  accelJerkThr   = ACCEL_PRESET_JERK[level - 1];
  accelStableImpact = accelImpactThr * 35 / 100;
  accelStableJerk   = accelJerkThr * 40 / 100;
}

const uint32_t ACCEL_DEBOUNCE_MS       = 120;
const uint32_t ACCEL_COOLDOWN_MS       = 5000;
const uint32_t ACCEL_STARTUP_IGNORE_MS = 2500;
const uint32_t ACCEL_REBASE_MS         = 3000;
const float ACCEL_BASELINE_ALPHA = 0.015f;
const uint16_t ACCEL_SAMPLE_GAP_US = 120;
const float ACCEL_COUNTS_PER_G = 410.0f;

int accelX = 0, accelY = 0, accelZ = 0;
float accelBase[3] = {0, 0, 0};
float accelPrev[3] = {0, 0, 0};
bool accelPrevValid = false;
int accelImpact = 0, accelPeakImpact = 0, accelJerk = 0;
int recentImpact = 0, recentJerk = 0, accelRecentPeak = 0;
uint32_t recentImpactT = 0, recentJerkT = 0, lastAccelSampleT = 0, hitWinStart = 0;
uint8_t hitCount = 0;
float accelMagnitude = 0, accelBaselineMagnitude = 0;
uint32_t lastAccelHitTime = 0, lastAccidentTriggerTime = 0, totalAccelHits = 0;
uint32_t accelReadyAt = 0, calmSince = 0;
volatile bool accidentTrigger = false;

static int median3(int a, int b, int c)
{
  if (a > b) { int t = a; a = b; b = t; }
  if (b > c) b = c;
  return a > b ? a : b;
}

void sampleAccel()
{
  int x[3], y[3], z[3];

  for (uint8_t i = 0; i < 3; i++)
  {
    x[i] = analogRead(ACCEL_X_PIN);
    y[i] = analogRead(ACCEL_Y_PIN);
    z[i] = analogRead(ACCEL_Z_PIN);
    if (i < 2) delayMicroseconds(ACCEL_SAMPLE_GAP_US);
  }

  accelX = median3(x[0], x[1], x[2]);
  accelY = median3(y[0], y[1], y[2]);
  accelZ = median3(z[0], z[1], z[2]);
}

void triggerAccident(const char* reason)
{
  uint32_t now = millis();
  if (lastAccidentTriggerTime != 0 && now - lastAccidentTriggerTime < ACCEL_COOLDOWN_MS) return;

  lastAccidentTriggerTime = now;
  accidentTrigger = true;
  logEvent("IMPACT %s i=%d j=%d", reason, recentImpact, recentJerk);
}

void readAccelerometer()
{
  uint32_t now = millis();
  sampleAccel();

  float cur[3] = {(float)accelX, (float)accelY, (float)accelZ};
  accelMagnitude = sqrtf(cur[0] * cur[0] + cur[1] * cur[1] + cur[2] * cur[2]);

  if (!accelPrevValid)
  {
    for (int k = 0; k < 3; k++) { accelBase[k] = cur[k]; accelPrev[k] = cur[k]; }
    accelPrevValid = true;
  }

  float d0 = cur[0] - accelBase[0], d1 = cur[1] - accelBase[1], d2 = cur[2] - accelBase[2];
  float j0 = cur[0] - accelPrev[0], j1 = cur[1] - accelPrev[1], j2 = cur[2] - accelPrev[2];

  accelImpact = (int)sqrtf(d0 * d0 + d1 * d1 + d2 * d2);
  float jr = sqrtf(j0 * j0 + j1 * j1 + j2 * j2);
  uint32_t dt = (lastAccelSampleT == 0) ? ACCEL_SAMPLE_MS : now - lastAccelSampleT;
  lastAccelSampleT = now;
  bool gap = dt > ACCEL_MAX_GAP_MS;
  accelJerk = gap ? 0 : (int)(jr * (float)ACCEL_SAMPLE_MS / (float)(dt < ACCEL_SAMPLE_MS ? ACCEL_SAMPLE_MS : dt));
  for (int k = 0; k < 3; k++) accelPrev[k] = cur[k];

  accelBaselineMagnitude = sqrtf(accelBase[0] * accelBase[0] + accelBase[1] * accelBase[1] + accelBase[2] * accelBase[2]);
  if (accelImpact > accelPeakImpact) accelPeakImpact = accelImpact;
  if (accelImpact > accelRecentPeak) accelRecentPeak = accelImpact;

  if (accelJerk <= accelStableJerk)
  {
    for (int k = 0; k < 3; k++)
      accelBase[k] += ACCEL_BASELINE_ALPHA * (cur[k] - accelBase[k]);
  }
  else
  {
    if (calmSince == 0) calmSince = now;
    else if (now - calmSince >= ACCEL_REBASE_MS)
    {
      for (int k = 0; k < 3; k++) accelBase[k] = cur[k];
      calmSince = 0;
    }
  }

  if (helmetState != ST_RIDING && helmetState != ST_ALCOHOL_WARN) return;

  if (now < accelReadyAt)
  {
    for (int k = 0; k < 3; k++) { accelBase[k] = cur[k]; accelPrev[k] = cur[k]; }
    accelImpact = 0; accelJerk = 0; accelPeakImpact = 0;
    recentImpact = 0; recentJerk = 0; hitCount = 0;
    return;
  }

  if (gap) { recentImpact = 0; recentJerk = 0; hitCount = 0; return; }

  if (accelImpact >= recentImpact || now - recentImpactT > ACCEL_WINDOW_MS) { recentImpact = accelImpact; recentImpactT = now; }
  if (accelJerk   >= recentJerk   || now - recentJerkT   > ACCEL_WINDOW_MS) { recentJerk   = accelJerk;   recentJerkT   = now; }

  if (accelImpact >= accelImpactThr * 7 / 10)
  {
    if (hitCount == 0 || now - hitWinStart > ACCEL_WINDOW_MS) { hitWinStart = now; hitCount = 0; }
    if (hitCount < 255) hitCount++;
  }
  else if (now - hitWinStart > ACCEL_WINDOW_MS) hitCount = 0;

  bool sharp = recentImpact >= accelImpactThr && recentJerk >= accelJerkThr;
  bool heavy = recentImpact >= (int)(accelImpactThr * ACCEL_HEAVY_FACTOR) &&
               recentJerk   >= (int)(accelJerkThr * ACCEL_HEAVY_JERK_FACTOR);

  if ((!sharp && !heavy) || hitCount < ACCEL_CONFIRM_SAMPLES) return;
  if (now - lastAccelHitTime < ACCEL_DEBOUNCE_MS) return;

  lastAccelHitTime = now;
  totalAccelHits++;
  Serial.printf("[ACCEL] x=%d y=%d z=%d impact=%d jerk=%d dt=%ums hits=%u\n", accelX, accelY, accelZ, recentImpact, recentJerk, (unsigned)dt, hitCount);
  triggerAccident(sharp ? "SHARP" : "HEAVY");
  recentImpact = 0;
  recentJerk = 0;
  hitCount = 0;
}

void armAccidentSensor()
{
  sampleAccel();
  float cur[3] = {(float)accelX, (float)accelY, (float)accelZ};
  for (int k = 0; k < 3; k++)
  {
    accelBase[k] = cur[k];
    accelPrev[k] = cur[k];
  }
  accelPrevValid = true;
  accelReadyAt = millis() + ACCEL_STARTUP_IGNORE_MS;
  accelPeakImpact = 0;
  recentImpact = 0;
  recentJerk = 0;
  accelRecentPeak = 0;
  hitCount = 0;
  lastAccelHitTime = 0;
  lastAccidentTriggerTime = 0;
  accidentTrigger = false;
}

// =====================================================
// GPS
// =====================================================

const double GPS_MIN_SPEED_KMPH = 2.0;

double gpsLat = 0, gpsLng = 0, gpsSpeedKmph = 0, gpsMaxSpeedKmph = 0;
uint8_t gpsSats = 0;
bool gpsFixNow = false, gpsSpeedValid = false, gpsEverFixed = false, gpsWiringFault = false;
unsigned long gpsLastFixMillis = 0;

void feedGPS()
{
  while (Serial2.available()) gps.encode(Serial2.read());

  if (gps.satellites.isValid()) gpsSats = gps.satellites.value();
  gpsWiringFault = (millis() > 8000 && gps.charsProcessed() < 10);

  if (gps.location.isValid() && gps.location.age() < 5000)
  {
    portENTER_CRITICAL(&gpsMux);
    gpsLat = gps.location.lat();
    gpsLng = gps.location.lng();

    if (gps.speed.isValid() && gps.speed.age() < 5000)
    {
      double v = gps.speed.kmph();
      gpsSpeedKmph = (v < GPS_MIN_SPEED_KMPH) ? 0.0 : v;
      gpsSpeedValid = true;
      if (gpsSpeedKmph > gpsMaxSpeedKmph) gpsMaxSpeedKmph = gpsSpeedKmph;
    }
    else { gpsSpeedValid = false; gpsSpeedKmph = 0.0; }

    gpsFixNow = true;
    gpsEverFixed = true;
    gpsLastFixMillis = millis();
    portEXIT_CRITICAL(&gpsMux);
  }
  else
  {
    gpsFixNow = false;
    gpsSpeedValid = false;
    gpsSpeedKmph = 0.0;
  }
}

bool buildLocation(String& text, String& link)
{
  double lat, lng;
  bool ever, fresh;
  unsigned long lastFix;

  portENTER_CRITICAL(&gpsMux);
  lat = gpsLat; lng = gpsLng; ever = gpsEverFixed; fresh = gpsFixNow; lastFix = gpsLastFixMillis;
  portEXIT_CRITICAL(&gpsMux);

  if (!ever) { text = "GPS fix not available yet"; link = ""; return false; }

  link = "https://maps.google.com/?q=" + String(lat, 6) + "," + String(lng, 6);
  text = fresh ? "Live location" : "Last known location (" + String((millis() - lastFix) / 1000) + " s ago)";
  return true;
}

// =====================================================
// STATE HELPERS
// =====================================================

bool helmetWorn()
{
#if ENABLE_WEAR_SENSOR
  return digitalRead(WEAR_PIN) == LOW;
#else
  return true;
#endif
}

bool motorAllowed() { return helmetState == ST_RIDING || helmetState == ST_ALCOHOL_WARN; }

const char* stateName()
{
  switch (helmetState)
  {
    case ST_VERIFY:        return "VERIFY";
    case ST_WARMUP:        return "WARMUP";
    case ST_PRESTART:      return "PRESTART";
    case ST_RIDING:        return "RIDING";
    case ST_ALCOHOL_WARN:  return "ALCOHOL_WARN";
    case ST_ACC_COUNTDOWN: return "ACC_COUNTDOWN";
    case ST_ACC_ALERT:     return "ACC_ALERT";
  }
  return "UNKNOWN";
}

int stateTotalSeconds()
{
  switch (helmetState)
  {
    case ST_WARMUP:        return WARMUP_MS / 1000;
    case ST_ALCOHOL_WARN:  return ALCOHOL_WARN_MS / 1000;
    case ST_ACC_COUNTDOWN: return ACCIDENT_CANCEL_MS / 1000;
    default: return 0;
  }
}

int stateSecondsLeft()
{
  unsigned long el = millis() - stateSince;
  unsigned long total = (unsigned long)stateTotalSeconds() * 1000UL;
  if (total == 0 || el >= total) return 0;
  return (int)((total - el + 999) / 1000);
}

TaskHandle_t notificationTaskHandle = NULL;
#define NOTIFY_ALCOHOL         (1UL << 0)
#define NOTIFY_ACCIDENT        (1UL << 1)
#define NOTIFY_LOCATION        (1UL << 2)
#define NOTIFY_SAFE            (1UL << 3)
#define NOTIFY_VERIFY_REQUEST  (1UL << 4)
#define NOTIFY_VERIFIED        (1UL << 5)
#define NOTIFY_TEST            (1UL << 6)

void notify(uint32_t bits)
{
  if (notificationTaskHandle != NULL) xTaskNotify(notificationTaskHandle, bits, eSetBits);
}

void setState(HelmetState s)
{
  HelmetState prev = helmetState;
  helmetState = s;
  stateSince = millis();
  accidentDetected = (s == ST_ACC_COUNTDOWN || s == ST_ACC_ALERT);

  if (s == ST_PRESTART) clearSince = millis();
  if (s == ST_RIDING && prev != ST_ALCOHOL_WARN) armAccidentSensor();
  if (s != ST_ACC_ALERT) manualSos = false;

  logEvent("State: %s", stateName());
}

struct HoldButton
{
  uint8_t pin; uint32_t holdMs; uint32_t pressStart; bool fired;
  HoldButton(uint8_t p, uint32_t h) : pin(p), holdMs(h), pressStart(0), fired(false) {}
  bool update()
  {
    if (digitalRead(pin) == LOW)
    {
      if (pressStart == 0) pressStart = millis();
      if (!fired && millis() - pressStart >= holdMs) { fired = true; return true; }
    }
    else { pressStart = 0; fired = false; }
    return false;
  }
};
HoldButton cancelBtn(CANCEL_PIN, CANCEL_HOLD_MS);
HoldButton sosBtn(SOS_PIN, SOS_HOLD_MS);

// =====================================================
// EMAIL SETTINGS
// =====================================================

String getRecipientEmail()
{
  String e;
  if (xSemaphoreTake(cfgMutex, pdMS_TO_TICKS(300)))
  {
    e = recipientEmail;
    xSemaphoreGive(cfgMutex);
  }
  return e;
}

void loadEmailSettings()
{
  preferences.begin("helmet", true);
  recipientEmail = preferences.getString("email", "");
  emailEnabled = preferences.getBool("emailEnabled", false);
  preferences.end();
}

void saveEmailSettings(const String& email, bool enabled)
{
  preferences.begin("helmet", false);
  preferences.putString("email", email);
  preferences.putBool("emailEnabled", enabled);
  preferences.end();

  if (xSemaphoreTake(cfgMutex, pdMS_TO_TICKS(500)))
  {
    recipientEmail = email;
    xSemaphoreGive(cfgMutex);
  }
  emailEnabled = enabled;
  logEvent("Email %s", enabled ? "enabled" : "disabled");
}

void loadSensitivity()
{
  preferences.begin("helmet", true);
  uint8_t l = preferences.getUChar("sens", 2);
  preferences.end();
  applySensitivity(l);
}

void saveSensitivity(uint8_t level)
{
  applySensitivity(level);
  preferences.begin("helmet", false);
  preferences.putUChar("sens", accelSensitivity);
  preferences.end();
  logEvent("Sensitivity: %s", accelSensitivity == 1 ? "LOW" : accelSensitivity == 2 ? "MEDIUM" : "HIGH");
}

bool validEmail(const String& e)
{
  int at = e.indexOf('@');
  return at > 0 && e.indexOf('.', at) > at + 1 && e.length() < 100 && e.indexOf(' ') < 0;
}

// =====================================================
// EMAIL / TELEGRAM SENDING
// =====================================================

bool sendEmailOnce(const char* subject, const String& htmlBody, const String& to)
{
  if (WiFi.status() != WL_CONNECTED) return false;

  mailSession.server.host_name = "smtp.gmail.com";
  mailSession.server.port = 465;
  mailSession.login.email = SENDER_EMAIL;
  mailSession.login.password = SENDER_PASSWORD;
  mailSession.login.user_domain = "";
  mailSession.time.ntp_server = "pool.ntp.org";
  mailSession.time.gmt_offset = 5.5;
  mailSession.time.day_light_offset = 0;

  SMTP_Message message;
  message.sender.name = "Smart Helmet";
  message.sender.email = SENDER_EMAIL;
  message.subject = subject;
  message.addRecipient("Emergency Contact", to.c_str());
  message.html.content = htmlBody.c_str();

  if (!smtp.connect(&mailSession))
  {
    Serial.println(smtp.errorReason());
    smtp.closeSession();
    return false;
  }
  bool ok = MailClient.sendMail(&smtp, &message);
  if (!ok) Serial.println(smtp.errorReason());
  smtp.closeSession();
  return ok;
}

bool sendEmail(const char* subject, const String& htmlBody)
{
  String to = getRecipientEmail();
  if (!emailEnabled || !validEmail(to)) return false;

  for (uint8_t a = 1; a <= EMAIL_RETRIES; a++)
  {
    if (sendEmailOnce(subject, htmlBody, to)) { logEvent("Email sent"); return true; }
    vTaskDelay(pdMS_TO_TICKS(3000));
  }
  logEvent("Email FAILED");
  return false;
}

bool sendTelegramText(const String& message)
{
  for (uint8_t a = 1; a <= TELEGRAM_RETRIES; a++)
  {
    if (WiFi.status() == WL_CONNECTED && bot.sendMessage(CHAT_ID, message, ""))
    {
      telegramLastOk = true;
      return true;
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
  telegramLastOk = false;
  logEvent("Telegram FAILED");
  return false;
}

void flushTelegramUpdates()
{
  int n = bot.getUpdates(bot.last_message_received + 1);
  for (uint8_t g = 0; n > 0 && g < 10; g++)
    n = bot.getUpdates(bot.last_message_received + 1);
}

String buildStatusText()
{
  String locText, link;
  bool hasLoc = buildLocation(locText, link);

  String m = "HELMET STATUS\n";
  m += "State: "; m += stateName(); m += "\n";
  m += "Motor: "; m += motorAllowed() ? "ON" : "OFF"; m += "\n";
  m += "Alcohol: "; m += String(alcoholPercent); m += "% ("; m += alcoholDetected ? "DETECTED" : "clear"; m += ")\n";
  m += "Speed: "; m += String(gpsSpeedKmph, 1); m += " km/h\n";
  m += "WiFi: "; m += String(WiFi.RSSI()); m += " dBm\n";
  m += locText;
  if (hasLoc) { m += "\n"; m += link; }
  return m;
}

void handleTelegramCommand(const String& cmd)
{
  if (cmd == "/status")
    sendTelegramText(buildStatusText());
  else if (cmd == "/location")
  {
    String t, l;
    if (buildLocation(t, l)) sendTelegramText(t + "\n" + l);
    else sendTelegramText(t);
  }
  else if (cmd == "/help" || cmd == "/start")
    sendTelegramText("Commands:\n/status - helmet status\n/location - current GPS location");
}

void pollTelegram()
{
  if (WiFi.status() != WL_CONNECTED) return;
  if (helmetState == ST_VERIFY && verifyRequested) return;

  int n = bot.getUpdates(bot.last_message_received + 1);

  for (uint8_t guard = 0; n > 0 && guard < 5; guard++)
  {
    for (int i = 0; i < n; i++)
    {
      if (bot.messages[i].chat_id != String(CHAT_ID)) continue;

      String txt = bot.messages[i].text;
      txt.trim();

      if (helmetState == ST_VERIFY)
      {
        if (!isDigitsOnly(txt)) continue;
        int r = checkPin(txt);
        if (r == 1) { logEvent("PIN accepted (Telegram)"); return; }
        sendTelegramText(r == 0 ? "Wrong PIN. Please try again." : "Too many wrong attempts. Locked for 60 seconds.");
      }
      else
        handleTelegramCommand(txt);
    }
    n = bot.getUpdates(bot.last_message_received + 1);
  }
}

// =====================================================
// MESSAGES
// =====================================================

bool sendVerifyPrompt()
{
  flushTelegramUpdates();
  return sendTelegramText("SMART HELMET ONLINE\n\nReply with your PIN to unlock the motor.");
}

bool sendAlcoholEmail(bool riding)
{
  String body = "<h2>SMART HELMET ALERT</h2><p><b>Alcohol has been detected.</b></p>";
  body += riding ? "<p>Detected <b>WHILE RIDING</b>. Warning issued; motor will be cut shortly.</p>"
                 : "<p>Detected <b>BEFORE START</b>. Motor is locked.</p>";
  body += "<p>Sensor level: <b>" + String(alcoholPercent) + "%</b><br>MQ-3 raw: <b>" + String(alcoholRaw) + "</b></p>";
  body += "<p>Please check the rider.</p>";
  return sendEmail("Smart Helmet - Alcohol Detected", body);
}

bool sendTelegramAlert(bool riding)
{
  String m = "SMART HELMET ALERT\n\nAlcohol detected!\n";
  m += riding ? "While RIDING - warning given, motor will be cut.\n" : "Before START - motor locked.\n";
  m += "Sensor level: " + String(alcoholPercent) + "%\nMQ-3 value: " + String(alcoholRaw);
  return sendTelegramText(m);
}

bool sendTelegramAccident(const String& locText, const String& link, bool manual)
{
  String m = manual ? "!!! MANUAL SOS !!!\n\nThe rider pressed the SOS button.\n"
                    : "!!! ACCIDENT DETECTED !!!\n\nThe rider may have met with an accident and did not cancel the alarm.\n";
  m += "Motor: STOPPED\nBuzzer: ON\n\nLocation: " + locText + "\n";
  m += link.length() ? link + "\n" : "Location updates will follow when GPS gets a fix.\n";
  m += "\nPlease check on the rider immediately.";
  return sendTelegramText(m);
}

bool sendAccidentEmail(const String& locText, const String& link, bool manual)
{
  String body = "<h2 style='color:#b91c1c'>SMART HELMET - ";
  body += manual ? "SOS" : "ACCIDENT";
  body += " ALERT</h2><p>Motor: <b>STOPPED</b></p><p>Location: <b>" + locText + "</b></p>";
  if (link.length()) body += "<p><a href='" + link + "'>Open in Google Maps</a></p><p>" + link + "</p>";
  body += "<p>Please check on the rider immediately. Live updates are sent on Telegram.</p>";
  return sendEmail(manual ? "Smart Helmet - SOS" : "Smart Helmet - ACCIDENT DETECTED", body);
}

// =====================================================
// NOTIFICATION TASK (core 0)
// =====================================================

void notificationTask(void* parameter)
{
  for (;;)
  {
    uint32_t events = 0;
    TickType_t wait = portMAX_DELAY;

    if (helmetState == ST_VERIFY) { if (verifyPromptSent) wait = pdMS_TO_TICKS(PIN_POLL_MS); }
    else wait = pdMS_TO_TICKS(CMD_POLL_MS);

    if (xTaskNotifyWait(0, 0xFFFFFFFF, &events, wait) != pdTRUE)
    {
      pollTelegram();
      continue;
    }

    notificationBusy = true;

    if (events & NOTIFY_VERIFY_REQUEST)
      if (sendVerifyPrompt()) verifyPromptSent = true;

    if (events & NOTIFY_VERIFIED)
      sendTelegramText("PIN accepted. Helmet unlocked.\nAlcohol check in progress - motor starts when clear.\nCommands: /status /location");

    if (events & NOTIFY_ACCIDENT)
    {
      String t, l;
      bool manual = manualSos;
      buildLocation(t, l);
      sendTelegramAccident(t, l, manual);
      sendAccidentEmail(t, l, manual);
    }

    if (events & NOTIFY_LOCATION)
    {
      String t, l;
      if (buildLocation(t, l))
        sendTelegramText("LOCATION UPDATE #" + String(locUpdatesSent) + "\n" + t + "\n" + l);
    }

    if (events & NOTIFY_ALCOHOL)
    {
      bool riding = alcoholWhileRiding;
      sendTelegramAlert(riding);
      vTaskDelay(pdMS_TO_TICKS(300));
      sendAlcoholEmail(riding);
    }

    if (events & NOTIFY_SAFE)
      sendTelegramText("Rider marked SAFE. Alert cancelled.");

    if (events & NOTIFY_TEST)
    {
      bool ok = sendTelegramText("TEST: Smart Helmet notifications are working.");
      bool em = sendEmail("Smart Helmet - Test", "<p>Test email from Smart Helmet.</p>");
      logEvent("Test: TG %s, mail %s", ok ? "OK" : "FAIL", em ? "OK" : "off/FAIL");
    }

    notificationBusy = false;
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

// =====================================================
// STATE MACHINE
// =====================================================

void startAccidentAlert(unsigned long now)
{
  setState(ST_ACC_ALERT);
  locUpdatesSent = 0;
  lastLocUpdate = now;
  notify(NOTIFY_ACCIDENT);
  firebaseAccidentEventPending = true;
}

void runStateMachine()
{
  unsigned long now = millis();

  bool cancel = cancelBtn.update() || resetRequested;
  resetRequested = false;

  bool sos = sosBtn.update();
  bool crash = accidentTrigger;
  accidentTrigger = false;

  if (sos && (helmetState == ST_PRESTART || helmetState == ST_RIDING ||
              helmetState == ST_ALCOHOL_WARN || helmetState == ST_ACC_COUNTDOWN))
  {
    manualSos = true;
    logEvent("MANUAL SOS");
    startAccidentAlert(now);
    return;
  }

  switch (helmetState)
  {
    case ST_VERIFY:
      if (verifyRequested)
      {
        verifyRequested = false;
        logEvent("Rider verified");
        notify(NOTIFY_VERIFIED);
        setState(ST_WARMUP);
      }
      else if (WiFi.status() == WL_CONNECTED && !verifyPromptSent && !notificationBusy &&
               (!promptTried || now - lastPromptTry >= PROMPT_RETRY_MS))
      {
        promptTried = true;
        lastPromptTry = now;
        notify(NOTIFY_VERIFY_REQUEST);
      }
      break;

    case ST_WARMUP:
      if (now - stateSince >= WARMUP_MS) setState(ST_PRESTART);
      break;

    case ST_PRESTART:
      if (alcoholDetected || !helmetWorn()) clearSince = now;
      else if (now - clearSince >= PRESTART_CLEAR_MS) setState(ST_RIDING);
      break;

    case ST_RIDING:
      if (crash && now - stateSince >= ARM_DELAY_MS) setState(ST_ACC_COUNTDOWN);
      else if (alcoholDetected) setState(ST_ALCOHOL_WARN);
      else if (!helmetWorn())
      {
        if (wornLostSince == 0) wornLostSince = now;
        else if (now - wornLostSince >= WEAR_LOSS_MS && gpsSpeedKmph < 5.0)
        {
          logEvent("Helmet removed");
          setState(ST_PRESTART);
        }
      }
      else wornLostSince = 0;
      break;

    case ST_ALCOHOL_WARN:
      if (crash) setState(ST_ACC_COUNTDOWN);
      else if (!alcoholDetected) setState(ST_RIDING);
      else if (now - stateSince >= ALCOHOL_WARN_MS) setState(ST_PRESTART);
      break;

    case ST_ACC_COUNTDOWN:
      if (cancel)
      {
        logEvent("Accident cancelled (false alarm)");
        setState(ST_PRESTART);
      }
      else if (now - stateSince >= ACCIDENT_CANCEL_MS)
        startAccidentAlert(now);
      break;

    case ST_ACC_ALERT:
      if (cancel)
      {
        logEvent("Alert reset by rider");
        setState(ST_PRESTART);
        notify(NOTIFY_SAFE);
      }
      else if (locUpdatesSent < LOC_UPDATE_MAX && now - lastLocUpdate >= LOC_UPDATE_MS && gpsEverFixed)
      {
        lastLocUpdate = now;
        locUpdatesSent++;
        notify(NOTIFY_LOCATION);
      }
      break;
  }

  if (helmetState != ST_VERIFY && helmetState != ST_WARMUP)
  {
    if (alcoholDetected && !previousAlcoholState)
    {
      alcoholWhileRiding = (helmetState == ST_ALCOHOL_WARN);
      logEvent("ALCOHOL detected (%d)", alcoholRaw);

      if (lastAlcoholNotify == 0 || now - lastAlcoholNotify >= ALCOHOL_NOTIFY_GAP)
      {
        lastAlcoholNotify = now;
        notify(NOTIFY_ALCOHOL);
        firebaseAlcoholEventPending = true;
      }
    }
    if (!alcoholDetected && previousAlcoholState) logEvent("Alcohol cleared");
    previousAlcoholState = alcoholDetected;
  }
}

// =====================================================
// BUZZER
// =====================================================

const uint16_t BUZZER_ALCOHOL_FREQ   = 2200;
const uint16_t BUZZER_COUNTDOWN_FREQ = 2700;
const uint16_t BUZZER_ALERT_FREQ     = 3200;

bool buzzerPwmAttached = false;
bool buzzerOn = false;
bool buzzerActive = false;
uint16_t buzzerFreq = 0;

void applyBuzzer(bool on, uint16_t freq)
{
  if (!buzzerPwmAttached) { buzzerOn = false; return; }

  if (on)
  {
    if (!buzzerActive || buzzerFreq != freq) ledcWriteTone(BUZZER_PIN, freq);
    buzzerActive = true;
    buzzerFreq = freq;
  }
  else
  {
    if (buzzerActive) ledcWriteTone(BUZZER_PIN, 0);
    buzzerActive = false;
    buzzerFreq = 0;
  }
  buzzerOn = on;
}

void updateBuzzer()
{
  unsigned long now = millis();

  switch (helmetState)
  {
    case ST_PRESTART:
      applyBuzzer(alcoholDetected && (now % 1000UL) < 500UL, BUZZER_ALCOHOL_FREQ);
      break;

    case ST_ALCOHOL_WARN:
      applyBuzzer((now % 600UL) < 300UL, BUZZER_ALCOHOL_FREQ);
      break;

    case ST_ACC_COUNTDOWN:
    {
      unsigned long el = now - stateSince;
      bool fast = el >= (ACCIDENT_CANCEL_MS - 5000UL);
      unsigned long period = fast ? 500UL : 1000UL;
      unsigned long onTime = fast ? 220UL : 300UL;
      applyBuzzer((el % period) < onTime, BUZZER_COUNTDOWN_FREQ);
      break;
    }

    case ST_ACC_ALERT:
      applyBuzzer(true, BUZZER_ALERT_FREQ);
      break;

    default:
      applyBuzzer(false, 0);
      break;
  }
}

void updateSafetyOutputs()
{
  if (motorAllowed()) relayOn(); else relayOff();
  updateBuzzer();
}

// =====================================================
// TELEMETRY
// =====================================================

void buildTelemetry(Json& j, bool forFirebase)
{
  double lat, lng;
  bool ever;
  portENTER_CRITICAL(&gpsMux);
  lat = gpsLat; lng = gpsLng; ever = gpsEverFixed;
  portEXIT_CRITICAL(&gpsMux);

  j.str("state", stateName());
  j.i("secondsLeft", stateSecondsLeft());
  j.i("secondsTotal", stateTotalSeconds());
  j.i("alcoholRaw", alcoholRaw);
  j.i("alcoholPercent", alcoholPercent);
  j.b("alcoholDetected", alcoholDetected);
  j.b("accident", accidentDetected);
  j.b("manualSos", manualSos);
  j.i("accelX", accelX);
  j.i("accelY", accelY);
  j.i("accelZ", accelZ);
  j.f("accelMagnitude", accelMagnitude, 1);
  j.f("accelBaseline", accelBaselineMagnitude, 1);
  j.i("impact", accelImpact);
  j.f("impactG", accelImpact / ACCEL_COUNTS_PER_G, 2);
  j.i("peakImpact", accelPeakImpact);
  j.i("jerk", accelJerk);
  j.u("impactEvents", totalAccelHits);
  j.b("motor", motorAllowed());
  j.b("buzzer", buzzerOn);
  j.b("gpsFix", gpsFixNow);
  j.b("gpsWiringFault", gpsWiringFault);
  j.b("hasLocation", ever);
  j.f("latitude", lat, 6);
  j.f("longitude", lng, 6);
  j.i("satellites", gpsSats);
  j.f("speedKmph", gpsSpeedKmph, 1);
  j.f("maxSpeedKmph", gpsMaxSpeedKmph, 1);
  j.b("speedValid", gpsSpeedValid);
  j.b("emailEnabled", emailEnabled);
  j.b("notificationBusy", notificationBusy);
  j.b("telegramOk", telegramLastOk);
  j.b("worn", helmetWorn());
  j.b("wearEnabled", ENABLE_WEAR_SENSOR);
  j.b("apMode", apMode);
  j.i("rssi", WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
  j.u("uptimeS", millis() / 1000);
  j.u("freeHeap", ESP.getFreeHeap());
  j.b("firebaseReady", firebaseReady);
  j.u("deviceMillis", millis());

  if (forFirebase) j.raw("timestamp", "{\".sv\":\"timestamp\"}");
}

// =====================================================
// FIREBASE
// =====================================================

void firebaseResultCallback(AsyncResult& result)
{
  String uid = result.uid();
  bool finished = false;

  if (result.isError())
  {
    finished = true;
    Serial.printf("[FIREBASE] Error: %s (%d)\n", result.error().message().c_str(), result.error().code());
  }
  else if (result.available())
    finished = true;

  if (finished && (uid == "liveData" || uid == "historyData") && firebasePending > 0)
    firebasePending--;
}

void initializeFirebase()
{
  if (firebaseInitStarted) return;
  firebaseInitStarted = true;

  firebaseSSL.setInsecure();

  initializeApp(firebaseClient, firebaseApp, getAuth(firebaseNoAuth));
  firebaseApp.getApp<RealtimeDatabase>(firebaseDatabase);
  firebaseDatabase.url(FIREBASE_DATABASE_URL);
  Serial.println("[FIREBASE] init started");
}

bool firebaseCanWrite()
{
  if (firebasePending > 0 && millis() - firebasePendingSince > 20000) firebasePending = 0;
  return firebasePending < FIREBASE_MAX_PENDING && ESP.getFreeHeap() >= FIREBASE_MIN_FREE_HEAP;
}

void firebaseWriteSnapshot(bool history)
{
  if (!firebaseReady || !firebaseCanWrite()) return;

  Json j;
  buildTelemetry(j, true);
  String body = j.done();

  if (firebasePending == 0) firebasePendingSince = millis();
  firebasePending++;

  if (history)
    firebaseDatabase.push<object_t>(firebaseClient, "/smartHelmet/history", object_t(body), firebaseResultCallback, "historyData");
  else
    firebaseDatabase.set<object_t>(firebaseClient, "/smartHelmet/live", object_t(body), firebaseResultCallback, "liveData");
}

void firebasePushEvent(const char* type, const char* path, const char* uid)
{
  if (!firebaseReady) return;

  Json j;
  buildTelemetry(j, true);
  j.str("eventType", type);
  firebaseDatabase.push<object_t>(firebaseClient, path, object_t(j.done()), firebaseResultCallback, uid);
}

void processFirebase()
{
  if (WiFi.status() != WL_CONNECTED) return;
  if (!firebaseInitStarted) initializeFirebase();

  firebaseApp.loop();

  if (!firebaseReady && firebaseApp.ready())
  {
    firebaseReady = true;
    logEvent("Firebase ready");
  }
  if (!firebaseReady) return;

  unsigned long now = millis();

  if (now - lastHeapReport >= 30000)
  {
    lastHeapReport = now;
    Serial.printf("[SYS] heap=%u min=%u fbPending=%u\n", ESP.getFreeHeap(), ESP.getMinFreeHeap(), firebasePending);
  }

  if (now - lastFirebaseLive >= FIREBASE_LIVE_MS)
  {
    lastFirebaseLive = now;
    firebaseWriteSnapshot(false);
  }

  if (helmetState != ST_VERIFY && now - lastFirebaseHistory >= FIREBASE_HISTORY_MS)
  {
    lastFirebaseHistory = now;
    firebaseWriteSnapshot(true);
  }

  if (firebaseAlcoholEventPending)
  {
    firebaseAlcoholEventPending = false;
    firebasePushEvent("alcohol", "/smartHelmet/alcoholEvents", "alcoholEvent");
  }

  if (firebaseAccidentEventPending)
  {
    firebaseAccidentEventPending = false;
    firebasePushEvent(manualSos ? "sos" : "accident", "/smartHelmet/accidentEvents", "accidentEvent");
  }
}

// =====================================================
// DASHBOARD WITH SPEEDOMETER & GOOGLE MAPS INTERFACE
// =====================================================

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Smart Helmet Dashboard</title>
<style>
:root{--bg:#07101d;--card:#101c2e;--line:#243550;--tx:#f1f5f9;--mut:#8fa3bd;--blue:#38bdf8;--grn:#22c55e;--yel:#f59e0b;--red:#ef4444}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top right,rgba(56,189,248,.11),transparent 32%),var(--bg);color:var(--tx);font:14px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;min-height:100vh}
button,input{font:inherit}
a{color:#7dd3fc;text-decoration:none}
select{background:#091526;color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font:inherit}
.wrap{max-width:1080px;margin:auto;padding:12px}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#0ea5e9,#2563eb);font-size:20px;box-shadow:0 0 20px rgba(14,165,233,.3)}
h1{margin:0;font-size:19px;letter-spacing:-.2px}
.sub{color:var(--mut);font-size:11px}
.meta{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.chip{border:1px solid var(--line);border-radius:999px;padding:6px 10px;font-size:11px;color:#cbd5e1;background:rgba(16,28,46,.85);white-space:nowrap}
.chip.ok{color:#4ade80}.chip.bad{color:#f87171;border-color:#7f1d1d}
.banner{display:none;padding:12px 14px;border-radius:12px;margin-bottom:10px;font-weight:800}
.banner.red{background:#7f1d1d;border:1px solid var(--red);animation:pulse 1s infinite}
.banner.yel{background:#78350f;border:1px solid var(--yel)}
@keyframes pulse{50%{opacity:.65}}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}
.card{background:linear-gradient(180deg,rgba(20,35,58,.96),rgba(13,25,43,.96));border:1px solid rgba(53,76,108,.6);border-radius:16px;padding:14px;min-width:0}
.card h2{margin:0 0 10px;font-size:13px;letter-spacing:.3px;color:#cbd5e1;display:flex;justify-content:space-between;align-items:center}
.s12{grid-column:span 12}.s8{grid-column:span 8}.s6{grid-column:span 6}.s4{grid-column:span 4}
.pill{display:inline-block;padding:8px 12px;border-radius:10px;font-weight:800;font-size:13px}
.pill.ok{background:rgba(34,197,94,.14);color:#4ade80}
.pill.warn{background:rgba(245,158,11,.14);color:#fbbf24}
.pill.bad{background:rgba(239,68,68,.16);color:#f87171}
.info{color:var(--mut);font-size:12px;margin-top:8px}
.bar{height:7px;background:#22334b;border-radius:9px;overflow:hidden;margin-top:10px}
.bar i{display:block;height:100%;width:0;background:var(--blue);transition:width .3s}
.row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}
input[type=password],input[type=email],input[type=text]{width:100%;min-width:0;background:#091526;color:var(--tx);border:1px solid var(--line);border-radius:10px;padding:10px}
.btn{border:0;border-radius:10px;padding:10px 14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0ea5e9,#2563eb);cursor:pointer;display:inline-flex;align-items:center;gap:6px;justify-content:center}
.btn.red{background:linear-gradient(135deg,#ef4444,#b91c1c)}
.btn.gray{background:#22334b}
.btn.sm{padding:6px 10px;font-size:11px;border-radius:8px}
.msg{font-size:11px;color:var(--mut);margin-top:6px;min-height:14px}
.gwrap{display:grid;grid-template-columns:104px 1fr;gap:14px;align-items:center}
.gauge{--v:0%;--c:#22c55e;width:100px;height:100px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c) var(--v),#22334b 0);position:relative}
.gauge:before{content:"";position:absolute;inset:9px;border-radius:50%;background:#0a1525}
.gauge div{position:relative;text-align:center}
.gauge b{font-size:22px;display:block;line-height:1}
.gauge small{font-size:9px;color:var(--mut);letter-spacing:.7px}

/* SPEEDOMETER STYLES */
.speed-box{display:flex;flex-direction:column;align-items:center;position:relative;padding:6px 0}
.speed-dial{position:relative;width:200px;height:140px;display:grid;place-items:center}
.speed-svg{width:100%;height:100%;overflow:visible}
.speed-track{fill:none;stroke:#1e2d42;stroke-width:12;stroke-linecap:round}
.speed-arc{fill:none;stroke:var(--blue);stroke-width:12;stroke-linecap:round;stroke-dasharray:314;stroke-dashoffset:314;transition:stroke-dashoffset .35s ease,stroke .35s ease;filter:drop-shadow(0 0 8px rgba(56,189,248,.4))}
.speed-center{position:absolute;bottom:8px;text-align:center}
.speed-num{font-size:42px;font-weight:900;line-height:.95;color:#fff;letter-spacing:-1px}
.speed-unit{font-size:11px;color:var(--mut);letter-spacing:1px;font-weight:700}
.speed-stats{display:flex;justify-content:space-between;width:100%;margin-top:10px;border-top:1px solid rgba(255,255,255,.07);padding-top:8px}
.speed-sub{font-size:11px;color:var(--mut)}
.speed-sub b{color:#fff;font-size:13px}

/* GOOGLE MAPS INTERFACE */
.gmap-box{position:relative;width:100%;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#071221;min-height:280px;height:300px}
.gmap-frame{width:100%;height:100%;border:0;display:block}
.gmap-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle,#0e1d33,#071221);color:var(--mut);gap:8px;text-align:center;padding:20px}
.gmap-radar{width:50px;height:50px;border-radius:50%;border:2px solid var(--blue);position:relative;display:grid;place-items:center;animation:radarPulse 2s infinite}
@keyframes radarPulse{0%{transform:scale(.8);opacity:.8}50%{transform:scale(1.1);opacity:1}100%{transform:scale(.8);opacity:.8}}
.gmap-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
.coords-badge{font-size:11px;padding:6px 10px;background:#091526;border-radius:8px;border:1px solid var(--line);color:#93c5fd;font-family:monospace}

.big{font-size:19px;font-weight:900}
.kv{color:var(--mut);font-size:11px;margin-top:6px}
canvas{width:100%;height:90px;display:block;background:#0a1525;border-radius:10px;border:1px solid var(--line)}
.lab{font-size:11px;color:var(--mut);margin:8px 0 4px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.st{background:rgba(8,18,32,.6);border:1px solid var(--line);border-radius:12px;padding:9px}
.st span{display:block;color:var(--mut);font-size:10px}
.st b{font-size:14px}
.st.ok b{color:#4ade80}.st.bad b{color:#f87171}.st.warn b{color:#fbbf24}
.ax{display:grid;grid-template-columns:16px 1fr 44px;gap:6px;align-items:center;margin:6px 0;font-size:11px}
.ax .t{height:6px;background:#22334b;border-radius:9px;overflow:hidden}.ax i{display:block;height:100%;width:50%;background:linear-gradient(90deg,#38bdf8,#818cf8)}
#log{max-height:210px;overflow:auto;font-size:12px}
#log div{padding:5px 0;border-bottom:1px solid #1a2a42}
#log span{color:var(--mut);margin-right:8px;font-variant-numeric:tabular-nums}
.chk{display:flex;gap:8px;align-items:center;color:var(--mut);font-size:12px;margin-top:8px}
@media(max-width:860px){.s8,.s6,.s4{grid-column:span 12}.stats{grid-template-columns:repeat(2,1fr)}}
</style></head>
<body><div class="wrap">

<div class="top">
  <div class="brand"><div class="logo">&#x1FA96;</div><div><h1>Smart Helmet</h1><div class="sub">Real-time safety &amp; telemetry dashboard</div></div></div>
  <div class="meta"><span class="chip ok" id="live">LIVE</span><span class="chip" id="rssi">WiFi --</span><span class="chip" id="uptime">up --</span></div>
</div>

<div id="offline" class="banner yel">Connection to helmet lost - retrying...</div>
<div id="alert" class="banner red"></div>

<div class="grid">

<!-- RIDE STATUS -->
<div class="card s8">
  <h2>RIDE STATUS</h2>
  <span id="rideStatus" class="pill warn">STARTING...</span>
  <div class="info" id="rideInfo"></div>
  <div class="bar"><i id="stateBar"></i></div>
  <div id="pinBox" style="display:none">
    <div class="row">
      <input type="password" id="pin" inputmode="numeric" maxlength="8" placeholder="Enter rider PIN">
      <button class="btn" onclick="verifyPin()">Verify &amp; Start</button>
    </div>
    <div class="msg" id="pinMsg"></div>
  </div>
</div>

<!-- EMERGENCY CONTROL -->
<div class="card s4">
  <h2>EMERGENCY CONTROL</h2>
  <div class="info" style="margin:0 0 10px">False alarm / rider safe? Cancels countdown or resets alert.</div>
  <button class="btn red" style="width:100%" onclick="resetAccident()">I'M OK - CANCEL / RESET</button>
  <div class="msg">Hardware SOS: hold SOS button for 3 s.</div>
</div>

<!-- RIDER SPEEDOMETER GAUGE -->
<div class="card s6">
  <h2><span>&#x23F1; RIDER SPEEDOMETER</span><span id="speedPill" class="chip">IDLE</span></h2>
  <div class="speed-box">
    <div class="speed-dial">
      <svg class="speed-svg" viewBox="0 0 200 130">
        <!-- Background arc: 0 to 120 km/h, 200 deg span -->
        <path class="speed-track" d="M 30 115 A 70 70 0 1 1 170 115"/>
        <path id="speedArc" class="speed-arc" d="M 30 115 A 70 70 0 1 1 170 115"/>
      </svg>
      <div class="speed-center">
        <div class="speed-num" id="speedNum">0.0</div>
        <div class="speed-unit">KM / H</div>
      </div>
    </div>
    <div class="speed-stats">
      <div class="speed-sub">Top Speed: <b id="maxSpeed">0.0</b> km/h</div>
      <div class="speed-sub">GPS Fix: <b id="fixStatus">SEARCHING</b></div>
      <div class="speed-sub">Sats: <b id="satsNum">0</b></div>
    </div>
    <div class="msg" id="gpsWarn" style="color:#f87171;width:100%"></div>
  </div>
</div>

<!-- LIVE LOCATION: GOOGLE MAPS INTERFACE -->
<div class="card s6">
  <h2><span>&#x1F30E; LIVE LOCATION (GOOGLE MAPS)</span><span id="mapStatusBadge" class="chip">GPS WAIT</span></h2>
  <div class="gmap-box" id="mapBox">
    <iframe id="gmapFrame" class="gmap-frame" src="about:blank" allowfullscreen="" loading="lazy"></iframe>
    <div id="mapPlaceholder" class="gmap-placeholder">
      <div class="gmap-radar">🛰️</div>
      <strong>Acquiring GPS Satellite Signal...</strong>
      <span style="font-size:12px">Google Map interface will load automatically when coordinates lock.</span>
    </div>
  </div>
  <div class="gmap-actions">
    <span class="coords-badge" id="coordsText">Waiting for fix...</span>
    <a id="gmapLink" class="btn sm" href="#" target="_blank" rel="noopener" style="display:none">&#x1F5FA; Open in Google Maps</a>
    <a id="gmapNav" class="btn sm gray" href="#" target="_blank" rel="noopener" style="display:none">&#x27A1; Directions</a>
  </div>
</div>

<!-- ALCOHOL SENSOR -->
<div class="card s6">
  <h2>ALCOHOL DETECTION (MQ-3)</h2>
  <div class="gwrap">
    <div class="gauge" id="alcG"><div><b id="alcPct">0%</b><small>LEVEL</small></div></div>
    <div><div class="big" id="alcTxt">SAFE</div>
    <div class="kv">Raw <b id="alcRaw">0</b> / threshold <b id="alcThr">0</b></div>
    <div class="bar"><i id="alcBar"></i></div></div>
  </div>
</div>

<!-- IMPACT SENSOR -->
<div class="card s6">
  <h2>IMPACT DETECTION (ADXL335)</h2>
  <div class="gwrap">
    <div class="gauge" id="impG"><div><b id="impG2">0.0</b><small>G (approx)</small></div></div>
    <div><div class="big" id="impTxt">NO ACCIDENT</div>
    <div class="kv">Impact <b id="impV">0</b> / trigger <b id="impThr">0</b> &bull; Jerk <b id="jerk">0</b></div>
    <div class="bar"><i id="impBar"></i></div>
    <div class="kv">Sensitivity <select id="sens" onchange="setSens()"><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select> <span id="jerkThr"></span></div></div>
  </div>
</div>

<!-- TRENDS -->
<div class="card s12">
  <h2>TRENDS (last 2 min)</h2>
  <div class="lab">Alcohol raw (dashed = threshold)</div><canvas id="chA"></canvas>
  <div class="lab">Impact (dashed = trigger)</div><canvas id="chI"></canvas>
</div>

<!-- SYSTEM STATUS -->
<div class="card s12">
  <h2>SYSTEM STATUS</h2>
  <div class="stats">
    <div class="st" id="sMotor"><span>Motor</span><b>-</b></div>
    <div class="st" id="sBuzz"><span>Buzzer</span><b>-</b></div>
    <div class="st" id="sWorn"><span>Helmet worn</span><b>-</b></div>
    <div class="st" id="sGps"><span>GPS</span><b>-</b></div>
    <div class="st" id="sTg"><span>Telegram</span><b>-</b></div>
    <div class="st" id="sMail"><span>Email alerts</span><b>-</b></div>
    <div class="st" id="sFb"><span>Firebase</span><b>-</b></div>
    <div class="st" id="sHeap"><span>Free memory</span><b>-</b></div>
  </div>
</div>

<!-- MOTION -->
<div class="card s6">
  <h2>MOTION TELEMETRY</h2>
  <div class="ax"><b>X</b><div class="t"><i id="xB"></i></div><span id="ax">0</span></div>
  <div class="ax"><b>Y</b><div class="t"><i id="yB"></i></div><span id="ay">0</span></div>
  <div class="ax"><b>Z</b><div class="t"><i id="zB"></i></div><span id="az">0</span></div>
  <div class="kv">Impact events: <b id="hits">0</b> &bull; Peak impact: <b id="peak">0</b></div>
</div>

<!-- EVENT LOG -->
<div class="card s6">
  <h2>EVENT LOG</h2>
  <div id="log"></div>
</div>

<!-- EMAIL ALERTS -->
<div class="card s12">
  <h2>EMAIL NOTIFICATIONS &amp; DIAGNOSTICS</h2>
  <div class="row" style="grid-template-columns:1fr auto auto">
    <input type="email" id="email" placeholder="Emergency contact email">
    <button class="btn" onclick="saveEmail()">Save email</button>
    <button class="btn gray" onclick="testNotify()">Send test</button>
  </div>
  <label class="chk"><input type="checkbox" id="enabled"> Enable automatic email alerts for alcohol / accident / SOS</label>
  <div class="msg" id="emailMsg"></div>
</div>

</div></div>

<script>
const $=id=>document.getElementById(id);
const ST={
 VERIFY:['WAITING FOR PIN','warn','Enter rider PIN (or reply on Telegram) to unlock motor.'],
 WARMUP:['SENSOR WARMING UP','warn','Motor locked.'],
 PRESTART:['PRE-START CHECK','warn','Motor unlocks when alcohol check is clear and helmet is worn.'],
 RIDING:['RIDING - ALL SYSTEMS OK','ok','Accident detection and live telemetry active.'],
 ALCOHOL_WARN:['ALCOHOL WARNING','bad','Motor will be cut when timer ends.'],
 ACC_COUNTDOWN:['ACCIDENT? CANCEL NOW','bad','Cancel immediately if this is a false alarm.'],
 ACC_ALERT:['ALERT SENT','bad','Emergency contacts notified - live GPS updates active.']
};
const MAXH=120, HA=[], HI=[];
let fails=0,busy=false,lastLat=null,lastLng=null,lastMapUpdate=0;

function gauge(id,pct,col){const e=$(id);e.style.setProperty('--v',Math.max(0,Math.min(100,pct))+'%');e.style.setProperty('--c',col)}
function stat(id,txt,cls){const e=$(id);e.className='st '+(cls||'');e.querySelector('b').textContent=txt}
function axis(id,v){$(id).style.width=Math.max(2,Math.min(100,v/4095*100))+'%'}
function fmtUp(s){const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return 'up '+(h?h+'h ':'')+m+'m '+(s%60)+'s'}
function fmtT(s){return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}

function updateSpeedometer(spd, maxSpd, valid, sats){
  const s = Math.max(0, Number(spd)||0);
  $('speedNum').textContent = valid ? s.toFixed(1) : '--';
  $('maxSpeed').textContent = (Number(maxSpd)||0).toFixed(1);
  $('satsNum').textContent = sats;
  $('fixStatus').textContent = valid ? 'LOCKED' : 'SEARCHING';
  $('fixStatus').style.color = valid ? '#4ade80' : '#fbbf24';

  // Arc length is ~260 px on this SVG path
  const ARC_LEN = 260;
  const maxMeter = 120; // 0 to 120 km/h
  const pct = Math.min(1, s / maxMeter);
  const offset = ARC_LEN * (1 - pct);

  const arc = $('speedArc');
  arc.style.strokeDasharray = ARC_LEN;
  arc.style.strokeDashoffset = offset;

  let col = '#38bdf8';
  let pillTxt = 'STOPPED';
  if(!valid){ pillTxt = 'NO FIX'; col='#64748b'; }
  else if(s > 80){ pillTxt = 'OVERSPEED'; col='#ef4444'; }
  else if(s > 50){ pillTxt = 'FAST'; col='#f59e0b'; }
  else if(s > 3){ pillTxt = 'CRUISING'; col='#22c55e'; }

  arc.style.stroke = col;
  const pill = $('speedPill');
  pill.textContent = pillTxt;
  pill.style.color = col;
}

function updateGoogleMap(lat, lng, hasLoc, fresh){
  const frame = $('gmapFrame');
  const ph = $('mapPlaceholder');
  const badge = $('mapStatusBadge');
  const coords = $('coordsText');
  const gLink = $('gmapLink');
  const gNav = $('gmapNav');

  if(!hasLoc || !lat || !lng){
    ph.style.display = 'flex';
    frame.style.display = 'none';
    badge.textContent = 'NO FIX';
    badge.className = 'chip bad';
    coords.textContent = 'GPS waiting for satellites...';
    gLink.style.display = 'none';
    gNav.style.display = 'none';
    return;
  }

  ph.style.display = 'none';
  frame.style.display = 'block';
  badge.textContent = fresh ? 'LIVE GPS' : 'LAST KNOWN';
  badge.className = fresh ? 'chip ok' : 'chip warn';
  coords.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);

  const gUrl = 'https://maps.google.com/maps?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) + '&hl=en&z=16&output=embed';
  const gDirect = 'https://www.google.com/maps/search/?api=1&query=' + lat.toFixed(6) + ',' + lng.toFixed(6);
  const gDirections = 'https://www.google.com/maps/dir/?api=1&destination=' + lat.toFixed(6) + ',' + lng.toFixed(6);

  gLink.href = gDirect;
  gLink.style.display = 'inline-flex';
  gNav.href = gDirections;
  gNav.style.display = 'inline-flex';

  // Avoid reloading iframe constantly unless position changed by > ~5-10 meters or initial load
  const now = Date.now();
  const moved = lastLat === null || Math.abs(lat - lastLat) > 0.00008 || Math.abs(lng - lastLng) > 0.00008;
  if (moved || (now - lastMapUpdate > 25000)) {
    lastLat = lat;
    lastLng = lng;
    lastMapUpdate = now;
    if (frame.src !== gUrl) {
      frame.src = gUrl;
    }
  }
}

function chart(id,arr,max,thr,col){
 const c=$(id),r=window.devicePixelRatio||1,w=c.width=c.clientWidth*r,h=c.height=c.clientHeight*r,x=c.getContext('2d');
 const y=v=>h-Math.min(1,v/max)*(h-8)-4;
 if(thr){x.strokeStyle='#ef4444aa';x.setLineDash([6,6]);x.beginPath();x.moveTo(0,y(thr));x.lineTo(w,y(thr));x.stroke();x.setLineDash([])}
 x.strokeStyle=col;x.lineWidth=2*r;x.beginPath();
 arr.forEach((v,i)=>{const px=w-(arr.length-1-i)/(MAXH-1)*w;i?x.lineTo(px,y(v)):x.moveTo(px,y(v))});x.stroke();
}

function render(d){
 const s=ST[d.state]||[d.state,'warn',''];
 const el=$('rideStatus');el.className='pill '+s[1];
 el.textContent=(d.manualSos&&d.state==='ACC_ALERT')?'MANUAL SOS SENT':s[0]+(d.state==='ACC_COUNTDOWN'?' - '+d.secondsLeft+'s':'');
 let info=s[2];
 if(d.state==='PRESTART'&&d.alcoholDetected)info='START BLOCKED - alcohol detected.';
 if(d.state==='PRESTART'&&d.wearEnabled&&!d.worn)info='Waiting for the helmet to be worn.';
 if(d.secondsLeft>0&&(d.state==='WARMUP'||d.state==='ALCOHOL_WARN'))info+=' '+d.secondsLeft+'s remaining.';
 $('rideInfo').textContent=info;
 $('pinBox').style.display=d.state==='VERIFY'?'block':'none';
 $('stateBar').style.width=(d.secondsTotal>0?100*d.secondsLeft/d.secondsTotal:0)+'%';

 const al=$('alert');
 if(d.state==='ACC_ALERT'||d.state==='ACC_COUNTDOWN'){al.style.display='block';al.className='banner red';al.textContent=d.state==='ACC_ALERT'?'ALERT ACTIVE - contacts notified':'POSSIBLE ACCIDENT - cancel within '+d.secondsLeft+'s'}
 else if(d.state==='ALCOHOL_WARN'){al.style.display='block';al.className='banner yel';al.textContent='ALCOHOL DETECTED - motor cut in '+d.secondsLeft+'s'}
 else al.style.display='none';
 document.title=(al.style.display==='block'?'\u26A0 ':'')+'Smart Helmet';

 // Update Speedometer & Google Maps
 updateSpeedometer(d.speedKmph, d.maxSpeedKmph, d.speedValid && d.gpsFix, d.satellites);
 updateGoogleMap(d.latitude, d.longitude, d.hasLocation, d.gpsFix);
 $('gpsWarn').textContent = d.gpsWiringFault ? 'No data from GPS module - check wiring / antenna.' : '';

 gauge('alcG',d.alcoholPercent,d.alcoholDetected?'#ef4444':'#22c55e');
 $('alcPct').textContent=d.alcoholPercent+'%';
 $('alcTxt').textContent=d.alcoholDetected?'ALCOHOL DETECTED':'SAFE';
 $('alcRaw').textContent=d.alcoholRaw;$('alcThr').textContent=d.alcoholThreshold;
 $('alcBar').style.width=d.alcoholPercent+'%';$('alcBar').style.background=d.alcoholDetected?'#ef4444':'#22c55e';

 const pk=Math.max(d.impact,d.impactRecentPeak||0);
 const ip=100*pk/(d.impactThreshold*1.6);
 gauge('impG',ip,d.accident?'#ef4444':(pk>=d.impactThreshold?'#f59e0b':'#38bdf8'));
 $('impG2').textContent=d.impactG.toFixed(1);
 $('impTxt').textContent=d.accident?'ACCIDENT DETECTED':'NO ACCIDENT';
 $('impV').textContent=d.impact;$('impThr').textContent=d.impactThreshold;$('jerkThr').textContent='(jerk \u2265 '+d.jerkThreshold+')';if(document.activeElement!==$('sens'))$('sens').value=d.sensitivity;$('jerk').textContent=d.jerk;
 $('impBar').style.width=Math.min(100,ip)+'%';

 HA.push(d.alcoholRaw);HI.push(pk);
 if(HA.length>MAXH){HA.shift();HI.shift()}
 chart('chA',HA,4095,d.alcoholThreshold,'#22c55e');
 chart('chI',HI,d.impactThreshold*1.6,d.impactThreshold,'#38bdf8');

 stat('sMotor',d.motor?'ON':'OFF',d.motor?'ok':'');
 stat('sBuzz',d.buzzer?'ON':'OFF',d.buzzer?'warn':'');
 stat('sWorn',d.wearEnabled?(d.worn?'YES':'NO'):'N/A',d.wearEnabled?(d.worn?'ok':'bad'):'');
 stat('sGps',d.gpsWiringFault?'NO DATA':(d.gpsFix?'FIX OK':'SEARCHING'),d.gpsWiringFault?'bad':(d.gpsFix?'ok':'warn'));
 stat('sTg',d.telegramOk?'OK':'FAILING',d.telegramOk?'ok':'bad');
 stat('sMail',d.emailEnabled?'ON':'OFF',d.emailEnabled?'ok':'');
 stat('sFb',d.firebaseReady?'ONLINE':'OFFLINE',d.firebaseReady?'ok':'warn');
 stat('sHeap',Math.round(d.freeHeap/1024)+' KB',d.freeHeap<30000?'bad':'');

 $('ax').textContent=d.accelX;$('ay').textContent=d.accelY;$('az').textContent=d.accelZ;
 axis('xB',d.accelX);axis('yB',d.accelY);axis('zB',d.accelZ);
 $('hits').textContent=d.impactEvents;$('peak').textContent=d.peakImpact;

 $('rssi').textContent=d.apMode?'AP mode':(d.rssi?'WiFi '+d.rssi+' dBm':'WiFi off');
 $('uptime').textContent=fmtUp(d.uptimeS);

 const lg=$('log');lg.textContent='';
 (d.log||[]).forEach(e=>{const r=document.createElement('div'),t=document.createElement('span');t.textContent=fmtT(e.t);r.appendChild(t);r.appendChild(document.createTextNode(e.m));lg.appendChild(r)});
}

async function poll(){
 if(busy)return;busy=true;
 try{
  const c=new AbortController(),t=setTimeout(()=>c.abort(),3000);
  const r=await fetch('/data?t='+Date.now(),{cache:'no-store',signal:c.signal});clearTimeout(t);
  if(!r.ok)throw 0;
  render(await r.json());fails=0;
 }catch(e){fails++}
 busy=false;
 const off=fails>=3;
 $('offline').style.display=off?'block':'none';
 $('live').textContent=off?'OFFLINE':'LIVE';$('live').className='chip '+(off?'bad':'ok');
}

async function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body||''})}
async function setSens(){try{await post('/sensitivity','level='+$('sens').value)}catch(e){}}
async function resetAccident(){try{await post('/resetAccident');poll()}catch(e){}}
async function verifyPin(){
 const m=$('pinMsg');
 try{
  const r=await post('/verify','pin='+encodeURIComponent($('pin').value));
  m.textContent=r.status===200?'PIN accepted.':r.status===429?'Too many attempts. Wait 60s.':'Wrong PIN.';
  $('pin').value='';poll();
 }catch(e){m.textContent='Connection error.'}
}
async function saveEmail(){
 const m=$('emailMsg');
 try{
  const r=await post('/saveEmail','email='+encodeURIComponent($('email').value.trim())+($('enabled').checked?'&enabled=on':''));
  m.textContent=r.ok?'Settings saved.':(await r.text());
 }catch(e){m.textContent='Connection error.'}
}
async function testNotify(){
 try{await post('/test');$('emailMsg').textContent='Test alert triggered.'}catch(e){$('emailMsg').textContent='Error.'}
}
async function loadSettings(){
 try{const d=await(await fetch('/settings',{cache:'no-store'})).json();$('email').value=d.email;$('enabled').checked=d.enabled}catch(e){}
}
$('pin').addEventListener('keydown',e=>{if(e.key==='Enter')verifyPin()});
setInterval(poll,1000);poll();loadSettings();
</script></body></html>
)rawliteral";

// =====================================================
// WEB HANDLERS
// =====================================================

#define REQUIRE_AUTH() do { } while (0)

void handleRoot()
{
  REQUIRE_AUTH();
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleData()
{
  REQUIRE_AUTH();

  Json j;
  buildTelemetry(j, false);
  j.i("alcoholThreshold", ALCOHOL_THRESHOLD);
  j.i("impactThreshold", accelImpactThr);
  j.i("jerkThreshold", accelJerkThr);
  j.i("sensitivity", accelSensitivity);
  j.i("impactRecentPeak", accelRecentPeak);
  accelRecentPeak = 0;
  j.raw("log", logJson());

  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", j.done());
}

void handleSettings()
{
  REQUIRE_AUTH();

  Json j;
  j.str("email", getRecipientEmail());
  j.b("enabled", emailEnabled);
  server.send(200, "application/json", j.done());
}

void handleSaveEmail()
{
  REQUIRE_AUTH();

  String email = server.arg("email");
  email.trim();
  bool enabled = server.hasArg("enabled");

  if (enabled && !validEmail(email))
  {
    server.send(400, "text/plain", "Enter a valid email address.");
    return;
  }
  saveEmailSettings(email, enabled);
  server.send(200, "text/plain", "Saved");
}

void handleResetAccident()
{
  REQUIRE_AUTH();
  resetRequested = true;
  logEvent("Cancel/reset from dashboard");
  server.send(200, "text/plain", "OK");
}

void handleTest()
{
  REQUIRE_AUTH();
  notify(NOTIFY_TEST);
  server.send(200, "text/plain", "OK");
}

void handleVerify()
{
  REQUIRE_AUTH();

  if (helmetState != ST_VERIFY) { server.send(200, "text/plain", "Already verified"); return; }

  String pin = server.arg("pin");
  pin.trim();
  int r = checkPin(pin);

  if (r == 1)      { logEvent("PIN accepted (dashboard)"); server.send(200, "text/plain", "OK"); }
  else if (r == 0) server.send(403, "text/plain", "Wrong PIN");
  else             server.send(429, "text/plain", "Locked");
}

void handleSensitivity()
{
  REQUIRE_AUTH();
  int l = server.arg("level").toInt();
  if (l < 1 || l > 3) { server.send(400, "text/plain", "level 1-3"); return; }
  saveSensitivity((uint8_t)l);
  server.send(200, "text/plain", "OK");
}

void handleNotFound() { server.send(404, "text/plain", "Not found"); }

// =====================================================
// WIFI
// =====================================================

const unsigned long WIFI_RETRY_INTERVAL = 10000;
unsigned long lastWiFiRetry = 0;
uint8_t wifiIdx = 0;

bool hasSecondWiFi() { return strlen(WIFI_SSID_2) > 0; }

void beginWiFi(uint8_t idx)
{
  WiFi.disconnect();
  if (idx == 0) WiFi.begin(WIFI_SSID_1, WIFI_PASS_1);
  else          WiFi.begin(WIFI_SSID_2, WIFI_PASS_2);
}

void connectWiFiAtStartup()
{
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  Serial.println("\nConnecting to WiFi...");
  beginWiFi(0);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000)
  {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASS);
    apMode = true;
    Serial.print("No WiFi - fallback hotspot '" AP_SSID "' at ");
    Serial.println(WiFi.softAPIP());
  }
}

void maintainWiFi()
{
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWiFiRetry < WIFI_RETRY_INTERVAL) return;

  lastWiFiRetry = millis();
  if (hasSecondWiFi()) wifiIdx ^= 1;
  beginWiFi(wifiIdx);
}

// =====================================================
// SETUP / LOOP
// =====================================================

unsigned long lastSensorRead = 0;
const unsigned long ACCEL_INTERVAL = 10;
unsigned long lastAccelRead = 0;

void playStartupTune()
{
  const uint16_t notes[] = {523, 659, 784, 1047, 784, 659, 523, 659, 784, 988, 1047, 988, 784, 659, 523};
  const uint16_t durs[]  = {180, 180, 180, 300, 180, 180, 180, 180, 180, 180, 300, 180, 180, 180, 650};

  for (uint8_t i = 0; i < sizeof(notes) / sizeof(notes[0]); i++)
  {
    ledcWriteTone(BUZZER_PIN, notes[i]);
    delay(durs[i] + 25);
  }
  ledcWriteTone(BUZZER_PIN, 0);
}

void setup()
{
  relayOff();

  Serial.begin(115200);
  delay(300);

  // Initialize JHD162A 16x2 LCD
  lcd.begin(16, 2);
  lcd.clear();
  lcdLine(0, "SMART HELMET");
  lcdLine(1, "STARTING...");

  cfgMutex = xSemaphoreCreateMutex();

  pinMode(ALCOHOL_PIN, INPUT);
  pinMode(ACCEL_X_PIN, INPUT);
  pinMode(ACCEL_Y_PIN, INPUT);
  pinMode(ACCEL_Z_PIN, INPUT);
  pinMode(CANCEL_PIN, INPUT_PULLUP);
  pinMode(SOS_PIN, INPUT_PULLUP);
#if ENABLE_WEAR_SENSOR
  pinMode(WEAR_PIN, INPUT_PULLUP);
#endif

  analogReadResolution(12);
  analogSetPinAttenuation(ALCOHOL_PIN, ADC_11db);
  analogSetPinAttenuation(ACCEL_X_PIN, ADC_11db);
  analogSetPinAttenuation(ACCEL_Y_PIN, ADC_11db);
  analogSetPinAttenuation(ACCEL_Z_PIN, ADC_11db);

  buzzerPwmAttached = ledcAttach(BUZZER_PIN, 2700, 8);
  if (buzzerPwmAttached)
  {
    ledcWriteTone(BUZZER_PIN, 0);
    playStartupTune();
  }

  Serial2.setRxBufferSize(1024);
  Serial2.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  loadEmailSettings();
  loadSensitivity();
  connectWiFiAtStartup();

#if TELEGRAM_VERIFY_TLS
  telegramClient.setCACert(TELEGRAM_CERTIFICATE_ROOT);
#else
  telegramClient.setInsecure();
#endif

  server.on("/", HTTP_GET, handleRoot);
  server.on("/data", HTTP_GET, handleData);
  server.on("/settings", HTTP_GET, handleSettings);
  server.on("/saveEmail", HTTP_POST, handleSaveEmail);
  server.on("/resetAccident", HTTP_POST, handleResetAccident);
  server.on("/verify", HTTP_POST, handleVerify);
  server.on("/test", HTTP_POST, handleTest);
  server.on("/sensitivity", HTTP_POST, handleSensitivity);
  server.onNotFound(handleNotFound);
  server.begin();

  xTaskCreatePinnedToCore(notificationTask, "NotificationTask", 20480, NULL, 1, &notificationTaskHandle, 0);
  if (notificationTaskHandle == NULL) Serial.println("ERROR: Notification task creation failed!");

  setState(ST_VERIFY);

  esp_task_wdt_config_t wdt;
  wdt.timeout_ms = 15000;
  wdt.idle_core_mask = 0;
  wdt.trigger_panic = true;
  if (esp_task_wdt_reconfigure(&wdt) != ESP_OK) esp_task_wdt_init(&wdt);
  esp_task_wdt_add(NULL);

  Serial.println("\nSMART HELMET STARTED - waiting for PIN");
  Serial.print("IP: ");
  Serial.println(apMode ? WiFi.softAPIP() : WiFi.localIP());
}

void loop()
{
  esp_task_wdt_reset();

  server.handleClient();
  feedGPS();
  maintainWiFi();
  processFirebase();

  unsigned long now = millis();
  if (now - lastAccelRead >= ACCEL_INTERVAL)
  {
    lastAccelRead = now;
    readAccelerometer();
  }

  if (now - lastSensorRead >= SENSOR_INTERVAL)
  {
    lastSensorRead = now;
    readAlcoholSensor();
    runStateMachine();
  }

  updateSafetyOutputs();
  updateLCD();
  delay(2);
}

#include "net_task.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>

#include "device_clock.h"
#include "secrets_include.h"
#include "send_policy.h"
#include "set_codec.h"
#include "set_store.h"
#include "settings_codec.h"

namespace presscall::net {

namespace {

constexpr uint32_t kStackBytes = 16 * 1024;  // TLS の握手にスタックを多く使う
constexpr UBaseType_t kPriority = 1;         // StorageTask（2）より低い。保存を先に進める
constexpr BaseType_t kCore = 0;
constexpr uint32_t kLoopMs = 200;
constexpr uint32_t kWaitForNtpMs = 1000;
constexpr uint32_t kSettingsPollMs = 5000;  // 設定を問い合わせる間隔（FR-S07。セット中は止める）

QueueHandle_t gInSetBox = nullptr;     // 計測 → NetTask：セット中か（長さ 1、上書き）
QueueHandle_t gSettingsBox = nullptr;  // NetTask → 計測：新しい設定（長さ 1、上書き）
DeviceSettings gCurrent{};             // NetTask が知っている最新の設定（NetTask だけが触る）
uint32_t gFingerprint = 0;             // 今のデバイストークンの指紋（保存した設定と照らし合わせる）

// ---- HTTPS ----

// TLS の接続は使い回す（keep-alive）。設定を 5 秒おきに問い合わせるたびに握手し直すと、
// テザリングの通信量と時間が増えるため。サーバに切られていれば次の begin() でつなぎ直す
NetworkClientSecure gClient;

/** ボディを持たない応答か（RFC 9110：204 と 304 にはボディがない） */
bool hasNoBody(int status) { return status == 204 || status == 304; }

/** API を呼ぶ。戻り値は HTTP の状態コード（通信失敗なら 0 以下） */
int request(const char* method, const char* path, const std::string* body, const String& ifNoneMatch,
            std::string& response) {
    HTTPClient http;
    http.setConnectTimeout(10000);
    http.setTimeout(15000);
    http.setReuse(true);
    if (!http.begin(gClient, String(API_BASE_URL) + path)) return -1;
    http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
    if (body) http.addHeader("Content-Type", "application/json");
    if (!ifNoneMatch.isEmpty()) http.addHeader("If-None-Match", ifNoneMatch);
    const int status =
        body ? http.sendRequest(method, reinterpret_cast<uint8_t*>(const_cast<char*>(body->data())),
                                body->size())
             : http.sendRequest(method);
    // 204・304 はボディを読まない。Content-Length のない 304 で読みに行くと、接続を使い回しているため
    // 「ボディの終わり（切断）」が来ず、タイムアウトまで待ってしまう
    if (status > 0 && !hasNoBody(status)) response = http.getString().c_str();
    http.end();
    if (status <= 0) gClient.stop();  // 壊れた接続を次に持ち越さない
    return status;
}

// ---- 401 ----

bool gAuthBlocked = false;

// 401 を受けたら、記録は残したまま、トークンを入れ直して再起動するまで通信しない（送信も設定の取得も）。
// ペアリングを実装したら、invalid は再ペアリング、revoked は再ペアリング待ちに分ける
void blockForAuth(SendOutcome outcome) {
    gAuthBlocked = true;
    Serial.printf("# NET device token %s. Network stopped; records are kept. "
                  "Update DEVICE_TOKEN in secrets.h and reboot\n",
                  outcome == SendOutcome::TokenRevoked ? "revoked" : "invalid");
}

// ---- 再送キュー（LittleFS）の先頭を 1 件送る ----
// 保存は StorageTask が行う。NetTask は読んで送り、受け取りを確認したら消すだけ

uint32_t gFailures = 0;
uint32_t gNextAttemptMs = 0;

void sendOldest() {
    String path;
    if (!store::oldest(path)) return;  // 未送信がなければフォルダも読まずに戻る

    StoredSetHeader h;
    std::string reps;
    if (!store::load(path, h, reps)) {
        Serial.printf("# NET dropped broken file %s\n", path.c_str());
        store::remove(path);
        return;
    }

    const TimeResolution t = resolveStartTime(h, store::bootId(), clock::timeSynced(),
                                              clock::nowEpochMs(), clock::uptimeMs());
    if (t.status == TimeStatus::Unrecoverable) {
        // NTP 前に記録して再起動をまたいだので、実時刻に直せない。誤った日付で残さないよう捨てる
        Serial.printf("# NET dropped set %s: recorded before NTP in a previous boot\n",
                      h.clientSetId.c_str());
        store::remove(path);
        return;
    }
    if (t.status == TimeStatus::WaitForNtp) {
        gNextAttemptMs = millis() + kWaitForNtpMs;
        return;
    }

    std::string response;
    const std::string body = buildSetBody(h, t.startedEpochMs, reps);
    const int status = request("POST", "/device/sets", &body, String(), response);

    const SendOutcome outcome = classifyResponse(status, response);
    switch (outcome) {
        case SendOutcome::Delivered:
            store::remove(path);
            gFailures = 0;
            Serial.printf("# NET sent set %s (%d), pending=%u\n", h.clientSetId.c_str(), status,
                          static_cast<unsigned>(store::count()));
            break;
        case SendOutcome::Rejected:
            // 再送しても通らない（API 仕様書 5 章）。原因を追えるように応答を残して捨てる
            Serial.printf("# NET rejected set %s (%d): %.200s\n", h.clientSetId.c_str(), status,
                          response.c_str());
            store::remove(path);
            gFailures = 0;
            break;
        case SendOutcome::TokenInvalid:
        case SendOutcome::TokenRevoked:
            blockForAuth(outcome);
            break;
        case SendOutcome::Retry:
            ++gFailures;
            gNextAttemptMs = millis() + retryDelayMs(gFailures);
            Serial.printf("# NET send failed (%d), retry in %lus\n", status,
                          static_cast<unsigned long>(retryDelayMs(gFailures) / 1000));
            break;
    }
}

// ---- 設定を問い合わせる（FR-S07・FR-D10） ----

uint32_t gNextPollMs = 0;

void pollSettings() {
    gNextPollMs = millis() + kSettingsPollMs;

    // 手元の version を If-None-Match に入れる。変わっていなければ 304 でボディなし
    const String etag = gCurrent.set.settingsVersion > 0
                            ? "\"" + String(gCurrent.set.settingsVersion) + "\""
                            : String();
    std::string response;
    const int status = request("GET", "/device/settings", nullptr, etag, response);

    if (status == 304) return;
    if (status == 401) {
        blockForAuth(classifyResponse(status, response));
        return;
    }
    if (status != 200) {
        // 次の問い合わせでまた試す。その間は今の設定で動く
        Serial.printf("# NET settings fetch failed (%d)\n", status);
        return;
    }

    DeviceSettings fetched;
    bool stillIgnored = false;
    if (!parseSettingsJson(response, fetched, &stillIgnored)) {
        Serial.printf("# NET settings response is invalid: %.200s\n", response.c_str());
        return;
    }
    if (fetched.set.settingsVersion == gCurrent.set.settingsVersion) return;
    if (stillIgnored) {
        // 黙って無視しない。サーバの値とデバイスの動きが違うことを知らせる
        Serial.printf("# NET WARNING: stillThreshold in settings v%lu is out of range "
                      "(must be > 0 and < %.2f m/s). Using the firmware default\n",
                      static_cast<unsigned long>(fetched.set.settingsVersion),
                      static_cast<double>(kStillThresholdMaxMps));
    }

    gCurrent = fetched;
    if (!store::saveSettings(fetched, gFingerprint)) {
        Serial.println("# NET ERROR: failed to save settings");
    }
    xQueueOverwrite(gSettingsBox, &fetched);  // 計測側はセットの合間に受け取る
    Serial.printf("# NET new settings v%lu: %s pause=%lu-%lums still=%s\n",
                  static_cast<unsigned long>(fetched.set.settingsVersion),
                  fetched.set.mode == Mode::AutoSignal ? "auto_signal" : "count_only",
                  static_cast<unsigned long>(fetched.set.pauseMinMs),
                  static_cast<unsigned long>(fetched.set.pauseMaxMs),
                  fetched.hasStillThreshold ? String(fetched.stillThreshold, 3).c_str() : "default");
}

bool inSetNow() {
    bool inSet = false;
    xQueuePeek(gInSetBox, &inSet, 0);
    return inSet;
}

// ---- タスク本体 ----

void netTask(void*) {
    gClient.useBuiltinCACertBundle();  // サーバ証明書を検証する（NFR-07）
    Serial.printf("# NET boot=%lu pending=%u\n", static_cast<unsigned long>(store::bootId()),
                  static_cast<unsigned>(store::count()));

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(TETHERING_SSID, TETHERING_PASSWORD);
    configTime(0, 0, "ntp.nict.jp", "time.google.com", "pool.ntp.org");  // UTC で合わせる

    bool wasConnected = false;
    bool wasSynced = false;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(kLoopMs));

        const bool connected = WiFi.status() == WL_CONNECTED;
        if (connected != wasConnected) {
            wasConnected = connected;
            Serial.println(connected ? "# NET tethering connected" : "# NET tethering lost");
            if (connected) {
                // つながったらすぐ再送と設定の問い合わせを試す
                gNextAttemptMs = millis();
                gNextPollMs = millis();
            }
        }
        const bool synced = clock::timeSynced();
        if (synced && !wasSynced) {
            wasSynced = true;
            Serial.println("# NET time synced (NTP)");
        }

        if (gAuthBlocked || !connected) continue;
        if (static_cast<int32_t>(millis() - gNextAttemptMs) >= 0) sendOldest();
        if (!gAuthBlocked && !inSetNow() && static_cast<int32_t>(millis() - gNextPollMs) >= 0) {
            pollSettings();
        }
    }
}

}  // namespace

uint32_t deviceTokenFingerprint() { return tokenFingerprint(DEVICE_TOKEN); }

bool start(const DeviceSettings& current) {
    gCurrent = current;
    gFingerprint = deviceTokenFingerprint();
    gInSetBox = xQueueCreate(1, sizeof(bool));
    gSettingsBox = xQueueCreate(1, sizeof(DeviceSettings));
    if (!gInSetBox || !gSettingsBox) return false;
    const bool notInSet = false;
    xQueueOverwrite(gInSetBox, &notInSet);
    return xTaskCreatePinnedToCore(netTask, "NetTask", kStackBytes, nullptr, kPriority, nullptr,
                                   kCore) == pdPASS;
}

void setInSet(bool inSet) {
    if (gInSetBox) xQueueOverwrite(gInSetBox, &inSet);
}

bool takeNewSettings(DeviceSettings& out) {
    return gSettingsBox && xQueueReceive(gSettingsBox, &out, 0) == pdTRUE;
}

}  // namespace presscall::net

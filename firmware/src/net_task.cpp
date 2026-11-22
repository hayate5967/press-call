#include "net_task.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>

#include <atomic>

#include "bench_page.h"
#include "device_clock.h"
#include "device_token.h"
#include "pairing_codec.h"
#include "recording_codec.h"
#include "secrets_include.h"
#include "wifi_creds.h"
#include "send_policy.h"
#include "set_codec.h"
#include "set_store.h"
#include "settings_codec.h"

namespace presscall::net {

namespace {

constexpr uint32_t kStackBytes = 16 * 1024;  // TLS の握手にスタックを多く使う
constexpr UBaseType_t kPriority = 1;         // StorageTask（2）より低い。保存を先に進める
constexpr BaseType_t kCore = 0;
constexpr uint32_t kLoopMs = 50;  // bench.local のページに素早く応えるため短めにする
constexpr uint32_t kWaitForNtpMs = 1000;
constexpr uint32_t kSettingsPollMs = 5000;  // 設定を問い合わせる間隔（FR-S07。セット中は止める）
constexpr uint32_t kRecordingPollMs = 5000;  // 開始・終了の指示を問い合わせる間隔（ADR-0011。セット中も続ける）
constexpr uint32_t kManualStaleMs = 15000;   // これより長く指示を取れなければ、動きで区切るほうに戻す
constexpr uint32_t kPageRefreshMs = 1000;   // bench.local の残り時間などを作り直す間隔
constexpr char kFirmwareVersion[] = "0.2.0";

QueueHandle_t gInSetBox = nullptr;     // 計測 → NetTask：セット中か（長さ 1、上書き）
QueueHandle_t gSettingsBox = nullptr;  // NetTask → 計測：新しい設定（長さ 1、上書き）
QueueHandle_t gRecordingBox = nullptr; // NetTask → 計測：開始・終了の指示（長さ 1、上書き）
QueueHandle_t gAutoStopBox = nullptr;  // 計測 → NetTask：自分で終えたセットの seq（長さ 1、上書き）
std::atomic<bool> gManualAvailable{false};  // 指示を最近取れているか（計測側が読む）
DeviceSettings gCurrent{};             // NetTask が知っている最新の設定（NetTask だけが触る）
uint32_t gFingerprint = 0;             // 今のデバイストークンの指紋（保存した設定と照らし合わせる）
std::string gToken;                    // 今のデバイストークン（空ならペアリング中）。NetTask だけが触る
// 今の持ち主（トークンの指紋。ペアリング中は 0）。StorageTask が記録に付けるので atomic にする
std::atomic<uint32_t> gOwnerFingerprint{0};

// ---- HTTPS ----

// TLS の接続は使い回す（keep-alive）。設定を 5 秒おきに問い合わせるたびに握手し直すと、
// テザリングの通信量と時間が増えるため。サーバに切られていれば次の begin() でつなぎ直す
NetworkClientSecure gClient;

/** ボディを持たない応答か（RFC 9110：204 と 304 にはボディがない） */
bool hasNoBody(int status) { return status == 204 || status == 304; }

/**
 * API を呼ぶ。戻り値は HTTP の状態コード（通信失敗なら 0 以下）。
 * withToken が true ならデバイストークンを付ける（ペアリングの API は付けない）
 */
int request(const char* method, const char* path, const std::string* body, const String& ifNoneMatch,
            std::string& response, bool withToken = true) {
    HTTPClient http;
    http.setConnectTimeout(10000);
    http.setTimeout(15000);
    http.setReuse(true);
    if (!http.begin(gClient, String(API_BASE_URL) + path)) return -1;
    if (withToken) http.addHeader("Authorization", String("Bearer ") + gToken.c_str());
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

// ---- bench.local のページ ----

// 注意：ページに応えるのは NetTask のループなので、HTTPS の呼び出し（最大 25 秒）を待っている間は
// bench.local も応答しない。ページは 5 秒ごとに読み直すので、通信が終われば表示は追いつく

PairingPage gPage;
PairingPage gShown;              // 最後に HTML にした状態
bool gHasShown = false;
uint32_t gLastPageMs = 0;
uint32_t gCodeExpiresAtMs = 0;  // 今のコードの期限（millis）

/** 状態を最新にし、表示が変わるときだけ HTML を作り直す */
void refreshPage() {
    gLastPageMs = millis();
    gPage.pendingSets = static_cast<uint32_t>(store::count());  // メモリの値を返すだけで軽い
    if (gPage.phase == PairingPage::Phase::ShowCode) {
        const int32_t left = static_cast<int32_t>(gCodeExpiresAtMs - millis());
        gPage.remainingSec = left > 0 ? static_cast<uint32_t>(left) / 1000 : 0;
    }
    if (gHasShown && looksSame(gPage, gShown)) return;
    bench::update(gPage);
    gShown = gPage;
    gHasShown = true;
}

void setPhase(PairingPage::Phase phase, const char* message = "") {
    gPage.phase = phase;
    gPage.message = message;
    refreshPage();
}

// ---- デバイストークンの入れ替え ----

uint32_t gFailures = 0;
uint32_t gNextAttemptMs = 0;
uint32_t gNextPollMs = 0;
uint32_t gNextRecordingPollMs = 0;  // 次に開始・終了の指示を問い合わせる時刻

/** トークンを使い始める（起動時に NVS から読んだとき・ペアリングで受け取ったとき） */
void adoptToken(const std::string& token) {
    gToken = token;
    const uint32_t fingerprint = tokenFingerprint(token.c_str());
    gOwnerFingerprint = fingerprint;
    if (fingerprint != gFingerprint) {
        // 別のデバイスとしてペアリングし直した。version はデバイスごとの番号なので、
        // 手元の version のまま問い合わせると 304 で新しいデバイスの設定を取り逃がす。必ず取り直す
        gFingerprint = fingerprint;
        gCurrent.set.settingsVersion = 0;
    }
    gFailures = 0;
    gNextAttemptMs = millis();
    gNextPollMs = millis();
    gNextRecordingPollMs = millis();
    setPhase(PairingPage::Phase::Paired);
}

uint32_t gNextPairingMs = 0;
bool gHasCode = false;
bool gPairingStopped = false;  // 拒否された。電源を入れ直すまでペアリングしない

/**
 * 401 を受けたら、トークンを消してペアリングし直す（2026-11-17 決定）。
 * invalid（存在しない）も revoked（Web アプリで失効させた）も同じ扱いで、ログだけ分ける。
 * 未送信の記録は LittleFS に残すが、ペアリングし直した後は送らずに捨てる
 * （持ち主が変わりうるため。sendOldest の belongsToCurrentOwner）
 */
void forgetToken(SendOutcome why) {
    Serial.printf("# NET device token %s. Records are kept; starting pairing\n",
                  why == SendOutcome::TokenRevoked ? "revoked" : "invalid");
    token::clear();
    gToken.clear();
    gOwnerFingerprint = 0;
    gHasCode = false;
    gNextPairingMs = millis();
    setPhase(PairingPage::Phase::Requesting,
             why == SendOutcome::TokenRevoked ? "このベンチは無効にされました。もう一度追加してください"
                                              : "");
}

// ---- ペアリング（RFC 8628 方式、API 仕様書 4 章） ----

PairingCode gCode;
uint32_t gPollIntervalMs = 0;
uint32_t gPairingFailures = 0;

void pairingFailed(const char* what, int status) {
    ++gPairingFailures;
    const uint32_t wait = retryDelayMs(gPairingFailures);
    gNextPairingMs = millis() + (wait > gPollIntervalMs ? wait : gPollIntervalMs);
    Serial.printf("# NET pairing: %s failed (%d), retry in %lus\n", what, status,
                  static_cast<unsigned long>(wait / 1000));
}

/** POST /device/authorize：新しいコードを受け取る */
void requestCode() {
    gPage.phase = PairingPage::Phase::Requesting;  // 直前のメッセージ（失効した理由など）は残す
    refreshPage();
    const std::string body = std::string("{\"firmwareVersion\":\"") + kFirmwareVersion + "\"}";
    std::string response;
    const int status = request("POST", "/device/authorize", &body, String(), response, false);
    PairingCode code;
    if (status != 200 || !parseAuthorizeResponse(response, code)) {
        gPollIntervalMs = 0;
        pairingFailed("authorize", status);
        if (gPage.message.empty()) gPage.message = "サーバにつながりません。しばらくお待ちください";
        refreshPage();
        return;
    }
    gCode = code;
    gHasCode = true;
    gPairingFailures = 0;
    gPollIntervalMs = code.intervalSec * 1000;
    gCodeExpiresAtMs = millis() + code.expiresInSec * 1000;
    gNextPairingMs = millis() + gPollIntervalMs;
    gPage.userCode = code.userCode;
    gPage.verificationUriComplete = code.verificationUriComplete;
    setPhase(PairingPage::Phase::ShowCode);
    // deviceCode は合言葉なので出さない。userCode は画面に出すものなのでログに出してよい
    Serial.printf("# NET pairing code %s (open http://bench.local or %s)\n", code.userCode.c_str(),
                  code.verificationUriComplete.c_str());
}

/** POST /device/token：許可されたか問い合わせる */
void pollToken() {
    const std::string body = buildTokenRequestBody(gCode.deviceCode);
    std::string response;
    const int status = request("POST", "/device/token", &body, String(), response, false);
    std::string token;
    switch (classifyTokenResponse(status, response, token)) {
        case PollOutcome::Granted:
            gHasCode = false;
            gCode = PairingCode{};
            if (!token::save(token)) {
                // 今の起動中は使えるが、再起動したらペアリングし直しになる
                Serial.println("# NET ERROR: failed to save device token to NVS");
            }
            Serial.println("# NET paired");
            adoptToken(token);
            return;
        case PollOutcome::Pending:
            gPairingFailures = 0;
            gNextPairingMs = millis() + gPollIntervalMs;
            return;
        case PollOutcome::SlowDown:
            gPollIntervalMs += kSlowDownStepSec * 1000;
            gNextPairingMs = millis() + gPollIntervalMs;
            return;
        case PollOutcome::Denied:
            // 拒否されたらペアリングをやめる（API 仕様書 4 章）。新しいコードを出し続けると、
            // 近くにいる別の人が許可できてしまう。やり直すには電源を入れ直す
            gHasCode = false;
            gCode = PairingCode{};
            gPairingStopped = true;
            setPhase(PairingPage::Phase::Denied);
            Serial.println("# NET pairing denied. Reboot to pair again");
            return;
        case PollOutcome::Restart:
            // 期限切れなど。新しいコードで最初から
            gHasCode = false;
            gNextPairingMs = millis();
            Serial.printf("# NET pairing code expired (%d), requesting a new one\n", status);
            return;
        case PollOutcome::Retry:
            pairingFailed("token", status);
            return;
    }
}

void pairingStep() {
    if (gPairingStopped) return;
    if (static_cast<int32_t>(millis() - gNextPairingMs) < 0) return;
    const bool expired = static_cast<int32_t>(millis() - gCodeExpiresAtMs) >= 0;
    if (!gHasCode || expired) {
        requestCode();
    } else {
        pollToken();
    }
}

// ---- 再送キュー（LittleFS）の先頭を 1 件送る ----
// 保存は StorageTask が行う。NetTask は読んで送り、受け取りを確認したら消すだけ

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

    if (!belongsToCurrentOwner(h.ownerFingerprint, gOwnerFingerprint)) {
        // ペアリングし直す前（前の持ち主）の記録。新しい持ち主のアカウントに入れないよう捨てる
        Serial.printf("# NET dropped set %s: recorded under a previous pairing\n",
                      h.clientSetId.c_str());
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
            forgetToken(outcome);
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
        forgetToken(classifyResponse(status, response));
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

// ---- セットの開始・終了の指示（ADR-0011） ----

uint32_t gLastRecordingOkMs = 0;
bool gHasRecordingOk = false;
bool gHasPendingStop = false;  // サーバにまだ伝えられていない「自分で終えた」
uint32_t gPendingStopSeq = 0;

/** 応答の指示を、この機器の uptime に直して計測側に渡す */
void deliverRecording(const RecordingCommand& c, uint64_t responseUptimeMs) {
    RecordingInstruction ins;
    ins.seq = c.seq;
    ins.recording = c.recording;
    if (c.startedAtMs >= 0) {
        ins.startUptimeMs = serverTimeToUptime(c.startedAtMs, c.serverTimeMs, responseUptimeMs);
    }
    if (c.stoppedAtMs >= 0) {
        ins.hasStop = true;
        ins.stopUptimeMs = serverTimeToUptime(c.stoppedAtMs, c.serverTimeMs, responseUptimeMs);
    }
    xQueueOverwrite(gRecordingBox, &ins);
}

/** GET /device/recording：指示を取る（5 秒おき、セット中も） */
void pollRecording() {
    gNextRecordingPollMs = millis() + kRecordingPollMs;
    std::string response;
    const int status = request("GET", "/device/recording", nullptr, String(), response);
    const uint64_t responseUptime = clock::uptimeMs();
    if (status == 401) {
        forgetToken(classifyResponse(status, response));
        return;
    }
    RecordingCommand c;
    if (status != 200 || !parseRecordingJson(response, c)) {
        // 15 秒取れなければ、計測側は動きで区切るほうに戻る（manualAvailable）
        Serial.printf("# NET recording fetch failed (%d)\n", status);
        return;
    }
    gLastRecordingOkMs = millis();
    gHasRecordingOk = true;
    deliverRecording(c, responseUptime);
}

/** PUT /device/recording：ボタンで始めたセットを自分で終えたことを伝える */
void reportAutoStop() {
    std::string response;
    const std::string body = buildStopRecordingBody(gPendingStopSeq);
    const int status = request("PUT", "/device/recording", &body, String(), response);
    if (status == 401) {
        forgetToken(classifyResponse(status, response));
        return;
    }
    if (status == 200) {
        gHasPendingStop = false;
        Serial.printf("# NET reported auto stop (seq %lu)\n",
                      static_cast<unsigned long>(gPendingStopSeq));
        RecordingCommand c;
        if (parseRecordingJson(response, c)) deliverRecording(c, clock::uptimeMs());
        return;
    }
    if (status == 422) {
        gHasPendingStop = false;  // 送り直しても通らない
        Serial.printf("# NET auto stop rejected: %.200s\n", response.c_str());
        return;
    }
    Serial.printf("# NET auto stop report failed (%d), will retry\n", status);  // 次の問い合わせで再び
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

    // NVS のトークンがあればそれで動く。なければペアリングから始める
    const std::string saved = token::load();
    if (saved.empty()) {
        Serial.println("# NET no device token. Pairing starts when tethering connects");
        setPhase(PairingPage::Phase::Requesting);
    } else {
        adoptToken(saved);
    }

    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    // 設定モードで登録した SSID・パスワード。なければ secrets.h の値（予備）
    WifiCredentials wifiCreds;
    const bool fromSaved = wifi::loadSaved(wifiCreds);
    if (fromSaved || wifi::loadEffective(wifiCreds)) {
        // どちらを使ったかだけを出す（SSID・パスワードは出さない）
        Serial.printf("# NET tethering credentials: %s\n",
                      fromSaved ? "saved by config mode" : "from secrets.h (fallback)");
        WiFi.begin(wifiCreds.ssid.c_str(), wifiCreds.password.c_str());
    } else {
        Serial.println("# NET no tethering SSID. Hold the BOOT button for 3 seconds to set it up");
    }
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
                // bench.local が引けないときに IP で直接開けるように出す（IP は秘密ではない）
                Serial.printf("# NET ip %s (http://%s)\n", WiFi.localIP().toString().c_str(),
                              WiFi.localIP().toString().c_str());
                bench::begin();  // http://bench.local（つながってから始める）
                // つながったらすぐ再送・設定の問い合わせ・ペアリングを試す
                gNextAttemptMs = millis();
                gNextPollMs = millis();
                gNextRecordingPollMs = millis();
                gNextPairingMs = millis();
            }
        }
        const bool synced = clock::timeSynced();
        if (synced && !wasSynced) {
            wasSynced = true;
            Serial.println("# NET time synced (NTP)");
        }

        bench::handle();
        if (millis() - gLastPageMs >= kPageRefreshMs) refreshPage();
        // 指示を最近取れていれば、計測側はボタンで区切る。取れなければ動きで区切る
        gManualAvailable = connected && !gToken.empty() && gHasRecordingOk &&
                           millis() - gLastRecordingOkMs < kManualStaleMs;
        if (!connected) continue;

        if (gToken.empty()) {
            // ペアリング中。記録は LittleFS に残り、ペアリングが済んだら送る
            pairingStep();
            continue;
        }
        if (static_cast<int32_t>(millis() - gNextAttemptMs) >= 0) sendOldest();
        uint32_t stoppedSeq = 0;
        if (xQueueReceive(gAutoStopBox, &stoppedSeq, 0) == pdTRUE) {
            gHasPendingStop = true;
            gPendingStopSeq = stoppedSeq;
        }
        if (!gToken.empty() && static_cast<int32_t>(millis() - gNextRecordingPollMs) >= 0) {
            if (gHasPendingStop) reportAutoStop();
            if (!gToken.empty()) pollRecording();
        }
        if (!gToken.empty() && !inSetNow() && static_cast<int32_t>(millis() - gNextPollMs) >= 0) {
            pollSettings();
        }
    }
}

}  // namespace

uint32_t deviceTokenFingerprint() {
    const std::string saved = token::load();
    return saved.empty() ? 0 : tokenFingerprint(saved.c_str());
}

uint32_t ownerFingerprint() { return gOwnerFingerprint; }

bool start(const DeviceSettings& current) {
    gCurrent = current;
    gFingerprint = deviceTokenFingerprint();
    gOwnerFingerprint = gFingerprint;
    gInSetBox = xQueueCreate(1, sizeof(bool));
    gSettingsBox = xQueueCreate(1, sizeof(DeviceSettings));
    gRecordingBox = xQueueCreate(1, sizeof(RecordingInstruction));
    gAutoStopBox = xQueueCreate(1, sizeof(uint32_t));
    if (!gInSetBox || !gSettingsBox || !gRecordingBox || !gAutoStopBox) return false;
    const bool notInSet = false;
    xQueueOverwrite(gInSetBox, &notInSet);
    return xTaskCreatePinnedToCore(netTask, "NetTask", kStackBytes, nullptr, kPriority, nullptr,
                                   kCore) == pdPASS;
}

void setInSet(bool inSet) {
    if (gInSetBox) xQueueOverwrite(gInSetBox, &inSet);
}

bool takeRecordingInstruction(RecordingInstruction& out) {
    return gRecordingBox && xQueueReceive(gRecordingBox, &out, 0) == pdTRUE;
}

bool manualAvailable() { return gManualAvailable; }

void notifyAutoStopped(uint32_t seq) {
    if (gAutoStopBox) xQueueOverwrite(gAutoStopBox, &seq);
}

bool takeNewSettings(DeviceSettings& out) {
    return gSettingsBox && xQueueReceive(gSettingsBox, &out, 0) == pdTRUE;
}

}  // namespace presscall::net

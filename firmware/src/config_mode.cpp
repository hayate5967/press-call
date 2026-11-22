#include "config_mode.h"

#include <Arduino.h>
#include <WebServer.h>
#include <WiFi.h>

#include <string>

#include "long_press.h"
#include "secrets_include.h"
#include "wifi_creds.h"
#include "wifi_form.h"

namespace presscall::configmode {

namespace {

constexpr uint8_t kButtonPin = 0;  // 基板の BOOT ボタン（押すと LOW）
constexpr uint32_t kLongPressMs = 3000;
constexpr uint32_t kTimeoutMs = 10 * 60 * 1000;  // 10 分
constexpr uint32_t kRestartDelayMs = 1500;       // 「保存しました」を表示してから再起動するまで

WebServer gServer(80);
ConfigPage gPage;

std::string apName() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char name[24];
    snprintf(name, sizeof(name), "press-call-%02X%02X", mac[4], mac[5]);
    return name;
}

void sendPage() {
    // パスワードは入れない。登録済みの SSID だけを見せる
    WifiCredentials saved;
    gPage.savedSsid = wifi::loadSaved(saved) ? saved.ssid : "";
    gServer.sendHeader("Cache-Control", "no-store");
    gServer.sendHeader("X-Content-Type-Options", "nosniff");
    gServer.send(200, "text/html; charset=utf-8", renderConfigPage(gPage).c_str());
}

bool gRestartPending = false;
uint32_t gRestartAtMs = 0;

void handleSave() {
    // 入力は小さいので、大きすぎるものは読まない
    if (gServer.clientContentLength() > static_cast<int>(kFormMaxBytes)) {
        gServer.send(413, "text/plain", "too large");
        return;
    }
    WifiCredentials c;
    const WifiFormError err =
        validateWifiCredentials(gServer.arg("ssid").c_str(), gServer.arg("password").c_str(), c);
    gPage.saved = false;
    if (err != WifiFormError::None) {
        gPage.message = wifiFormErrorMessage(err);
        gPage.messageIsError = true;
        sendPage();
        return;
    }
    if (!wifi::save(c)) {
        gPage.message = "保存できませんでした。もう一度お試しください";
        gPage.messageIsError = true;
        sendPage();
        return;
    }
    // SSID だけログに出す（パスワードは出さない）
    Serial.printf("# CONFIG saved ssid \"%s\" (%u bytes password). Restarting\n", c.ssid.c_str(),
                  static_cast<unsigned>(c.password.size()));
    gPage.message.clear();
    gPage.saved = true;
    sendPage();
    gRestartPending = true;
    gRestartAtMs = millis() + kRestartDelayMs;
}

void handleOther() {
    gServer.sendHeader("Location", "/");
    gServer.send(302, "text/plain", "");
}

}  // namespace

bool apPasswordUsable() {
    if (PRESSCALL_SECRETS_ARE_PLACEHOLDERS) return false;  // 仮の値のままの AP は作らない
    const size_t n = std::string(CONFIG_AP_PASSWORD).size();
    return n >= kPasswordMinChars && n <= kPasswordMaxChars;
}

bool run(void (*setLed)(bool on)) {
    if (!apPasswordUsable()) {
        Serial.println("# CONFIG cannot start: set CONFIG_AP_PASSWORD (8-63 chars) in include/secrets.h");
        return false;
    }
    WiFi.mode(WIFI_AP);
    const std::string name = apName();
    if (!WiFi.softAP(name.c_str(), CONFIG_AP_PASSWORD)) {
        Serial.println("# CONFIG cannot start: failed to create the access point");
        return false;
    }
    gPage = ConfigPage{};
    gPage.apName = name;
    gServer.on("/", HTTP_GET, sendPage);
    gServer.on("/save", HTTP_POST, handleSave);
    gServer.onNotFound(handleOther);
    gServer.begin();
    // AP の名前と、開くページの住所だけを出す（AP のパスワードは出さない）
    Serial.printf("# CONFIG mode: connect to Wi-Fi \"%s\" and open http://%s (10 min, BOOT 3s to cancel)\n",
                  name.c_str(), WiFi.softAPIP().toString().c_str());

    pinMode(kButtonPin, INPUT_PULLUP);
    LongPress cancel(kLongPressMs);
    const uint32_t startMs = millis();
    // 押したままの指で、入った直後に抜けないよう、いったん離すまで待つ
    bool released = false;
    for (;;) {
        gServer.handleClient();
        const uint32_t now = millis();
        setLed((now / 125) % 2 == 0);  // 0.25 秒周期の速い点滅（通常の記録中の点滅と見分ける）

        if (gRestartPending && static_cast<int32_t>(now - gRestartAtMs) >= 0) break;
        if (now - startMs >= kTimeoutMs) {
            Serial.println("# CONFIG timeout. Restarting");
            break;
        }
        const bool pressed = digitalRead(kButtonPin) == LOW;
        if (!pressed) released = true;
        if (released && cancel.update(now, pressed)) {
            Serial.println("# CONFIG cancelled by button. Restarting");
            break;
        }
        delay(5);
    }
    setLed(false);
    gServer.stop();
    WiFi.softAPdisconnect(true);
    delay(100);
    ESP.restart();
    return true;  // ここには来ない
}

}  // namespace presscall::configmode

// 設定モード（FR-C01〜C04）の設定ページ：入力の読み取りと、ページの HTML
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>
#include <string>

namespace presscall {

/** テザリングの SSID の長さ（バイト）の上限。Wi-Fi の規格（IEEE 802.11） */
constexpr size_t kSsidMaxBytes = 32;
/** WPA2 のパスワードの長さ（文字）。テザリングは WPA2 なので、この範囲だけ受け付ける */
constexpr size_t kPasswordMinChars = 8;
constexpr size_t kPasswordMaxChars = 63;
/** 設定ページの入力全体の上限（これを超える POST は読まない） */
constexpr size_t kFormMaxBytes = 512;

struct WifiCredentials {
    std::string ssid;
    std::string password;
};

enum class WifiFormError : uint8_t {
    None,
    SsidEmpty,
    SsidTooLong,
    PasswordLength,
};

/** application/x-www-form-urlencoded の値を元に戻す（+ は空白、%XX は 1 バイト）。形が壊れていれば false */
bool urlDecode(const std::string& in, std::string& out);

/**
 * すでにデコードした SSID とパスワードの長さを確かめる（ESP32 の WebServer は値をデコードして渡す）。
 * SSID の前後の空白は落とす（パスワードは落とさない。空白もパスワードの一部にありうる）
 */
WifiFormError validateWifiCredentials(const std::string& ssid, const std::string& password,
                                      WifiCredentials& out);

/** 設定ページの POST 本文（ssid=...&password=...）をデコードして、validateWifiCredentials で確かめる */
WifiFormError parseWifiForm(const std::string& body, WifiCredentials& out);

/** エラーの説明（ページに出す） */
const char* wifiFormErrorMessage(WifiFormError e);

/** 設定ページの内容 */
struct ConfigPage {
    std::string apName;        // このデバイスの AP の名前（案内に出す）
    std::string savedSsid;     // 今登録してある SSID（なければ空）。パスワードは出さない
    std::string message;       // 直前の操作の結果・エラー（なければ空）
    bool messageIsError = false;
    bool saved = false;        // 保存した直後（再起動の案内を出す）
};

/** 設定ページの HTML。スマホで片手でも押しやすい大きさで作る */
std::string renderConfigPage(const ConfigPage& page);

}  // namespace presscall

#include "wifi_form.h"

#include <cctype>

#include "pairing_codec.h"  // htmlEscape
namespace presscall {

namespace {

int hexValue(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

std::string trimSpaces(const std::string& s) {
    size_t b = 0, e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) ++b;
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) --e;
    return s.substr(b, e - b);
}

// パスワードの「文字数」。UTF-8 の続きのバイト（10xxxxxx）は数えない
size_t countChars(const std::string& s) {
    size_t n = 0;
    for (unsigned char c : s) {
        if ((c & 0xC0) != 0x80) ++n;
    }
    return n;
}

}  // namespace

bool urlDecode(const std::string& in, std::string& out) {
    std::string r;
    r.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        const char c = in[i];
        if (c == '+') {
            r.push_back(' ');
        } else if (c == '%') {
            if (i + 2 >= in.size()) return false;  // %XX の XX が足りない
            const int hi = hexValue(in[i + 1]);
            const int lo = hexValue(in[i + 2]);
            if (hi < 0 || lo < 0) return false;
            r.push_back(static_cast<char>(hi * 16 + lo));
            i += 2;
        } else {
            r.push_back(c);
        }
    }
    out = std::move(r);
    return true;
}

WifiFormError parseWifiForm(const std::string& body, WifiCredentials& out) {
    std::string ssid, password;
    size_t pos = 0;
    while (pos <= body.size()) {
        size_t amp = body.find('&', pos);
        if (amp == std::string::npos) amp = body.size();
        const std::string pair = body.substr(pos, amp - pos);
        const size_t eq = pair.find('=');
        if (eq != std::string::npos) {
            const std::string key = pair.substr(0, eq);
            std::string value;
            if (!urlDecode(pair.substr(eq + 1), value)) value.clear();
            if (key == "ssid") ssid = value;
            if (key == "password") password = value;
        }
        pos = amp + 1;
    }
    return validateWifiCredentials(ssid, password, out);
}

WifiFormError validateWifiCredentials(const std::string& rawSsid, const std::string& password,
                                      WifiCredentials& out) {
    const std::string ssid = trimSpaces(rawSsid);
    if (ssid.empty()) return WifiFormError::SsidEmpty;
    if (ssid.size() > kSsidMaxBytes) return WifiFormError::SsidTooLong;
    const size_t chars = countChars(password);
    if (chars < kPasswordMinChars || chars > kPasswordMaxChars) return WifiFormError::PasswordLength;
    out.ssid = ssid;
    out.password = password;
    return WifiFormError::None;
}

const char* wifiFormErrorMessage(WifiFormError e) {
    switch (e) {
        case WifiFormError::None: return "";
        case WifiFormError::SsidEmpty: return "ネットワーク名（SSID）を入力してください";
        case WifiFormError::SsidTooLong: return "ネットワーク名（SSID）は 32 バイトまでです";
        case WifiFormError::PasswordLength: return "パスワードは 8〜63 文字で入力してください";
    }
    return "";
}

std::string renderConfigPage(const ConfigPage& page) {
    std::string h;
    h += "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"
         "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
         "<title>press-call 設定</title><style>"
         "body{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;"
         "background:#e6f7ff;color:#0f1926;margin:0;padding:20px 16px 40px;font-size:17px}"
         "main{max-width:420px;margin:0 auto}h1{font-size:28px;margin:8px 0 4px}"
         "p{line-height:1.6}.card{background:#fff;border-radius:16px;padding:20px;margin-top:16px}"
         "label{display:block;font-weight:600;margin:16px 0 6px}"
         "input{width:100%;box-sizing:border-box;font-size:17px;padding:12px 14px;border:0;"
         "border-radius:10px;background:#dcecf6}"
         "button{width:100%;margin-top:24px;font-size:17px;font-weight:600;padding:14px;border:0;"
         "border-radius:999px;background:#0065dc;color:#fff}"
         ".msg{padding:12px 14px;border-radius:10px;margin-top:16px}"
         ".ok{background:#e1f5e8;color:#0a7e3a}.ng{background:#fde8e8;color:#b3191c}"
         ".sub{color:#4c5d6e;font-size:15px}</style></head><body><main>"
         "<h1>press-call 設定</h1>"
         "<p class=\"sub\">テザリング（iPhone のインターネット共有）の名前とパスワードを登録します。</p>";
    if (!page.message.empty()) {
        h += std::string("<div class=\"msg ") + (page.messageIsError ? "ng" : "ok") + "\">" +
             htmlEscape(page.message) + "</div>";
    }
    if (page.saved) {
        h += "<div class=\"card\"><p>保存しました。数秒でデバイスが再起動し、テザリングにつながります。"
             "このページは閉じてかまいません。</p></div>";
    } else {
        h += "<div class=\"card\"><form method=\"post\" action=\"/save\" autocomplete=\"off\">";
        if (!page.savedSsid.empty()) {
            h += "<p class=\"sub\">今の登録：" + htmlEscape(page.savedSsid) + "</p>";
        }
        h += "<label for=\"ssid\">ネットワーク名（SSID）</label>"
             "<input id=\"ssid\" name=\"ssid\" maxlength=\"32\" autocapitalize=\"off\" required>"
             "<label for=\"password\">パスワード（8〜63 文字）</label>"
             "<input id=\"password\" name=\"password\" type=\"password\" maxlength=\"63\" required>"
             "<button type=\"submit\">保存して再起動</button></form></div>"
             "<p class=\"sub\">iPhone の「設定」→「インターネット共有」の名前とパスワードを入れてください。"
             "デバイスは 2.4GHz にしかつながらないので、「互換性を優先」をオンにします。"
             "BOOT ボタンをもう一度 3 秒押すと、登録せずに通常の動きに戻ります。</p>";
    }
    h += "</main></body></html>";
    return h;
}

}  // namespace presscall

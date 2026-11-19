#include "pairing_codec.h"

#include <cmath>
#include <cstdio>

#include "json_reader.h"

namespace presscall {

namespace {

using json::Reader;

bool toUint32(double v, uint32_t& out) {
    if (v < 0 || v > 4294967295.0 || std::floor(v) != v) return false;
    out = static_cast<uint32_t>(v);
    return true;
}

bool isBase64UrlChar(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
           c == '-' || c == '_';
}

/** userCode の表示形（XXXX-XXXX。RFC 8628 推奨の子音 20 文字） */
bool isUserCode(const std::string& s) {
    static const char kAlphabet[] = "BCDFGHJKLMNPQRSTVWXZ";
    if (s.size() != 9 || s[4] != '-') return false;
    for (size_t i = 0; i < s.size(); ++i) {
        if (i == 4) continue;
        bool ok = false;
        for (const char* p = kAlphabet; *p; ++p) ok = ok || *p == s[i];
        if (!ok) return false;
    }
    return true;
}

bool startsWith(const std::string& s, const char* prefix) {
    return s.rfind(prefix, 0) == 0;
}

/** {"error":"..."} の error を読む。読めなければ空 */
std::string readError(const std::string& body) {
    Reader r(body);
    if (!r.consume('{') || r.consume('}')) return "";
    do {
        std::string key;
        if (!r.string(key) || !r.consume(':')) return "";
        if (key == "error") {
            std::string value;
            return r.string(value) ? value : "";
        }
        if (!r.skipValue()) return "";
    } while (r.consume(','));
    return "";
}

}  // namespace

bool parseAuthorizeResponse(const std::string& jsonText, PairingCode& out) {
    Reader r(jsonText);
    if (!r.consume('{')) return false;
    PairingCode c;
    double expiresIn = -1, interval = -1;
    if (!r.consume('}')) {
        do {
            std::string key;
            if (!r.string(key) || !r.consume(':')) return false;
            if (key == "deviceCode") {
                if (!r.string(c.deviceCode)) return false;
            } else if (key == "userCode") {
                if (!r.string(c.userCode)) return false;
            } else if (key == "verificationUriComplete") {
                if (!r.string(c.verificationUriComplete)) return false;
            } else if (key == "expiresIn") {
                if (!r.number(expiresIn)) return false;
            } else if (key == "interval") {
                if (!r.number(interval)) return false;
            } else if (!r.skipValue()) {
                return false;
            }
        } while (r.consume(','));
        if (!r.consume('}')) return false;
    }
    if (!r.atEnd()) return false;

    if (c.deviceCode.empty() || c.deviceCode.size() > 128) return false;
    for (char ch : c.deviceCode) {
        if (!isBase64UrlChar(ch)) return false;
    }
    if (!isUserCode(c.userCode)) return false;
    // リンクとしてページに出すので、http(s) 以外（javascript: など）は受け付けない
    if (!startsWith(c.verificationUriComplete, "https://") &&
        !startsWith(c.verificationUriComplete, "http://")) {
        return false;
    }
    if (c.verificationUriComplete.size() > 256) return false;
    if (!toUint32(expiresIn, c.expiresInSec) || c.expiresInSec == 0 || c.expiresInSec > 3600) {
        return false;
    }
    if (!toUint32(interval, c.intervalSec) || c.intervalSec == 0 || c.intervalSec > 60) {
        return false;
    }
    out = c;
    return true;
}

std::string buildTokenRequestBody(const std::string& deviceCode) {
    // deviceCode は parseAuthorizeResponse で base64url の文字だけと確かめてあるので、エスケープは不要
    return std::string("{\"grantType\":\"urn:ietf:params:oauth:grant-type:device_code\","
                       "\"deviceCode\":\"") +
           deviceCode + "\"}";
}

bool isPlausibleDeviceToken(const std::string& token) {
    if (!startsWith(token, "dvt_") || token.size() < 20 || token.size() > 100) return false;
    for (size_t i = 4; i < token.size(); ++i) {
        if (!isBase64UrlChar(token[i])) return false;
    }
    return true;
}

PollOutcome classifyTokenResponse(int status, const std::string& body, std::string& token) {
    if (status == 200) {
        Reader r(body);
        std::string accessToken;
        if (r.consume('{') && !r.consume('}')) {
            do {
                std::string key;
                if (!r.string(key) || !r.consume(':')) break;
                if (key == "accessToken") {
                    if (!r.string(accessToken)) break;
                } else if (!r.skipValue()) {
                    break;
                }
            } while (r.consume(','));
        }
        // 受け取り済みのコードは二度と使えないので、読めなかったら最初からやり直す
        if (!isPlausibleDeviceToken(accessToken)) return PollOutcome::Restart;
        token = accessToken;
        return PollOutcome::Granted;
    }
    if (status == 400) {
        const std::string error = readError(body);
        if (error == "authorization_pending") return PollOutcome::Pending;
        if (error == "slow_down") return PollOutcome::SlowDown;
        if (error == "access_denied") return PollOutcome::Denied;
        // expired_token・invalid_grant・invalid_request など
        return PollOutcome::Restart;
    }
    // 5xx・通信失敗（0 以下）・想定外の状態コード
    return PollOutcome::Retry;
}

std::string htmlEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '&': out += "&amp;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&#39;"; break;
            default: out += c;
        }
    }
    return out;
}

namespace {
uint32_t remainingMinutes(const PairingPage& p) { return (p.remainingSec + 59) / 60; }
}  // namespace

bool looksSame(const PairingPage& a, const PairingPage& b) {
    if (a.phase != b.phase || a.pendingSets != b.pendingSets || a.message != b.message) return false;
    if (a.phase != PairingPage::Phase::ShowCode) return true;
    return a.userCode == b.userCode && a.verificationUriComplete == b.verificationUriComplete &&
           remainingMinutes(a) == remainingMinutes(b);
}

std::string renderPairingPage(const PairingPage& page) {
    using Phase = PairingPage::Phase;
    std::string body;
    switch (page.phase) {
        case Phase::NoNetwork:
            body = "<p>テザリングにつながっていません。</p>";
            break;
        case Phase::Requesting:
            body = "<p>コードを受け取っています…</p>";
            break;
        case Phase::ShowCode: {
            char remaining[48];
            std::snprintf(remaining, sizeof(remaining), "残り %lu 分",
                          static_cast<unsigned long>(remainingMinutes(page)));
            body = "<p>このベンチを自分のアカウントに追加します。</p>"
                   "<p class=\"code\">" + htmlEscape(page.userCode) + "</p>"
                   "<p><a class=\"button\" href=\"" + htmlEscape(page.verificationUriComplete) +
                   "\">Web アプリで許可する</a></p>"
                   "<p class=\"muted\">Web アプリに同じコードが出ていることを確かめてから許可してください（" +
                   remaining + "）。</p>";
            break;
        }
        case Phase::Denied:
            body = "<p>拒否されました。もう一度ペアリングするには、ベンチの電源を入れ直してください。</p>";
            break;
        case Phase::Paired:
            body = "<p>✓ ペアリング済みです。記録は自動で送られます。</p>";
            break;
    }
    if (page.pendingSets > 0) {
        body += "<p class=\"muted\">未送信のセット：" + std::to_string(page.pendingSets) + " 件</p>";
    }
    if (!page.message.empty()) {
        body += "<p class=\"muted\">" + htmlEscape(page.message) + "</p>";
    }

    return "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\">"
           "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
           "<meta http-equiv=\"refresh\" content=\"5\">"
           "<title>press-call ベンチ</title><style>"
           "body{font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:16px;"
           "line-height:1.6}"
           ".code{font:700 2.2rem ui-monospace,monospace;letter-spacing:.1em;margin:16px 0}"
           ".button{display:inline-block;padding:12px 20px;border-radius:8px;background:#1d4ed8;"
           "color:#fff;text-decoration:none}"
           ".muted{color:#666}"
           "</style></head><body><h1>press-call ベンチ</h1>" +
           body + "</body></html>";
}

}  // namespace presscall

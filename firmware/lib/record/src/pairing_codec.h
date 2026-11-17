// ペアリング（RFC 8628 方式、API 仕様書 4 章、ADR-0006）の応答の読み取りと、bench.local のページ
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>
#include <string>

namespace presscall {

/** POST /device/authorize で受け取るもの */
struct PairingCode {
    std::string deviceCode;               // ESP32 だけが知る合言葉。画面にもログにも出さない
    std::string userCode;                 // 人が入力するコード（BCDF-GHJK）
    std::string verificationUriComplete;  // コード入力済みの許可画面の URL
    uint32_t expiresInSec = 0;
    uint32_t intervalSec = 0;
};

/** 応答の JSON を読む。足りない項目・おかしな値があれば false */
bool parseAuthorizeResponse(const std::string& json, PairingCode& out);

/** POST /device/token のリクエスト本文 */
std::string buildTokenRequestBody(const std::string& deviceCode);

enum class PollOutcome : uint8_t {
    Granted,  // 200：デバイストークンを受け取った
    Pending,  // authorization_pending：interval 秒後にもう一度
    SlowDown, // slow_down：間隔を 5 秒延ばす
    Denied,   // access_denied：拒否された。少し待ってから新しいコードでやり直す
    Restart,  // expired_token・invalid_grant など：新しいコードで最初からやり直す
    Retry,    // 5xx・通信失敗：同じコードのまま、時間を置いて問い合わせ直す
};

/** RFC 8628 の slow_down で延ばす秒数 */
constexpr uint32_t kSlowDownStepSec = 5;

/**
 * POST /device/token の応答を分類する。Granted のときだけ token にデバイストークンが入る。
 * 200 でもトークンの形がおかしければ Restart（保存しない）
 */
PollOutcome classifyTokenResponse(int status, const std::string& body, std::string& token);

/** デバイストークンらしい形か（dvt_ ＋ base64url。NVS に保存する前・読んだ後に確かめる） */
bool isPlausibleDeviceToken(const std::string& token);

/** HTML に埋め込むときのエスケープ（< > & " '） */
std::string htmlEscape(const std::string& s);

/** bench.local に出すページの状態 */
struct PairingPage {
    enum class Phase : uint8_t {
        NoNetwork,   // テザリングにつながっていない（この状態ではページ自体が見えないが、念のため）
        Requesting,  // コードを受け取っている途中
        ShowCode,    // コードと許可用リンクを表示中
        Denied,      // 拒否された。電源を入れ直すまでペアリングしない
        Paired,      // ペアリング済み（ふだんの状態）
    };
    Phase phase = Phase::Requesting;
    std::string userCode;
    std::string verificationUriComplete;
    uint32_t remainingSec = 0;   // コードの残り時間
    uint32_t pendingSets = 0;    // 未送信のセットの数
    std::string message;         // 補足（直前のエラーなど）
};

/** ページの HTML（数秒おきに自動で読み直す） */
std::string renderPairingPage(const PairingPage& page);

/**
 * 2 つの状態で、表示される内容が同じか（残り時間は「分」で表示するので分で比べる）。
 * 同じなら HTML を作り直さない
 */
bool looksSame(const PairingPage& a, const PairingPage& b);

}  // namespace presscall

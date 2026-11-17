// POST /device/sets の応答をどう扱うか、再送までどれだけ待つか（API 仕様書 5 章）
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>
#include <string>

namespace presscall {

enum class SendOutcome : uint8_t {
    Delivered,     // 200 / 201：サーバが受け取った。保存ファイルを消す（FR-S06）
    Rejected,      // 400 / 413 / 422：再送しても通らない。ログを残してファイルを消す
    TokenInvalid,  // 401 device_token_invalid（ヘッダーなし・形違いも含む）
    TokenRevoked,  // 401 device_token_revoked
    Retry,         // 5xx・通信失敗・その他：残して、間隔を延ばしながら再送
};

/** HTTP の状態コード（通信失敗なら 0 以下）と応答本文から、扱いを決める */
SendOutcome classifyResponse(int status, const std::string& body);

/** 失敗が failures 回続いたときの、次の再送までの待ち時間（5 秒から倍々、最大 5 分） */
uint32_t retryDelayMs(uint32_t failures);

}  // namespace presscall

#include "send_policy.h"

namespace presscall {

SendOutcome classifyResponse(int status, const std::string& body) {
    if (status == 200 || status == 201) return SendOutcome::Delivered;
    if (status == 401) {
        // 失効だけは「記録を残して再ペアリング待ち」と仕様で分けている。それ以外の 401 は invalid 扱い
        return body.find("\"device_token_revoked\"") != std::string::npos
                   ? SendOutcome::TokenRevoked
                   : SendOutcome::TokenInvalid;
    }
    // 400（JSON が壊れている）・413（大きすぎる）・422（入力ルール違反）は中身の問題なので、何度送っても同じ
    if (status == 400 || status == 413 || status == 422) return SendOutcome::Rejected;
    return SendOutcome::Retry;
}

uint32_t retryDelayMs(uint32_t failures) {
    constexpr uint32_t kBaseMs = 5000;
    constexpr uint32_t kMaxMs = 5 * 60 * 1000;
    if (failures == 0) return 0;
    uint32_t delay = kBaseMs;
    for (uint32_t i = 1; i < failures && delay < kMaxMs; ++i) delay *= 2;
    return delay < kMaxMs ? delay : kMaxMs;
}

}  // namespace presscall

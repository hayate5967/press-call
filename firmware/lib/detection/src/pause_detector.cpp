#include "pause_detector.h"

#include <cmath>

namespace presscall {

PauseDetector::PauseDetector(const DetectorConfig& config) : config_(config) {}

void PauseDetector::startAscending(uint32_t nowMs) {
    current_.pauseActualMs = nowMs - stillStartMs_;
    if (config_.mode == Mode::AutoSignal) {
        current_.pauseTargetMs = config_.pauseTargetMs;
        current_.isPremature = !signaled_;
        current_.reactionMs = signaled_ ? nowMs - signalAtMs_ : 0;
    }
    phase_ = Phase::Ascending;
}

Event PauseDetector::update(uint32_t nowMs, float velocity) {
    const float speed = std::fabs(velocity);
    const bool movingUp = velocity >= config_.moveVelocity;
    const bool movingDown = velocity <= -config_.moveVelocity;
    const bool still = speed <= config_.stillVelocity;

    switch (phase_) {
        case Phase::Top:
            if (movingDown) {
                current_ = RepResult{};
                signaled_ = false;
                phase_ = Phase::Descending;
            }
            break;

        case Phase::Descending:
            if (still) {
                stillStartMs_ = nowMs;
                phase_ = Phase::Still;
            }
            break;

        case Phase::Still:
            if (movingUp) {
                // 合図の前に挙げた（自動合図モードならフライング）
                startAscending(nowMs);
            } else if (movingDown) {
                // 胸に着く前の一瞬の減速だった。下降に戻す
                phase_ = Phase::Descending;
            } else if (config_.mode == Mode::AutoSignal &&
                       nowMs - stillStartMs_ >= config_.pauseTargetMs) {
                signaled_ = true;
                signalAtMs_ = nowMs;
                phase_ = Phase::Signaled;
                return Event::PressSignal;
            }
            break;

        case Phase::Signaled:
            if (movingUp) {
                startAscending(nowMs);
            }
            break;

        case Phase::Ascending:
            if (still) {
                // 挙げきって止まった（ロックアウト）
                lastRep_ = current_;
                phase_ = Phase::Top;
                return Event::RepCompleted;
            }
            break;
    }
    return Event::None;
}

}  // namespace presscall

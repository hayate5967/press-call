// レップの「下降 → 静止 → 合図 → 挙上」を判定する状態機械（ADR-003 のたたき台）
//
// Arduino にも ESP32 にも依存しない純粋な C++ にしてあり、PC 上でテストできる。
// 入力はバーの上下方向の速度（上向きが正、m/s）。速度の推定（加速度の積分）は別の部品が担当する。
#pragma once

#include <cstdint>

namespace presscall {

enum class Mode : uint8_t {
    AutoSignal,  // 自動合図モード：静止が待ち時間続いたら Press 合図
    CountOnly,   // 回数記録モード：合図は出さない
};

enum class Phase : uint8_t {
    Top,         // 挙上し終わってバーが上にある
    Descending,  // 下降中
    Still,       // 胸の上で静止中
    Signaled,    // Press 合図を出した後、挙上待ち
    Ascending,   // 挙上中
};

struct DetectorConfig {
    Mode mode = Mode::AutoSignal;
    uint32_t pauseTargetMs = 1000;  // 静止してから合図までの待ち時間（ランダムなら呼び出し側がレップごとに決める）
    float stillVelocity = 0.05f;    // これ以下の速さなら「止まっている」とみなす（m/s）
    float moveVelocity = 0.15f;     // これ以上の速さなら「動き出した」とみなす（m/s）
};

/** 1 レップ分の結果 */
struct RepResult {
    uint32_t pauseTargetMs = 0;  // 使った待ち時間（回数記録モードでは 0）
    uint32_t pauseActualMs = 0;  // 実際に静止していた時間
    uint32_t reactionMs = 0;     // 合図から挙上開始まで（フライングなら 0）
    bool isPremature = false;    // 合図より前に挙げた（フライング）
};

enum class Event : uint8_t {
    None,
    PressSignal,   // 今、Press 合図を出すべき
    RepCompleted,  // 1 レップ終わった（lastRep() で結果を取れる）
};

class PauseDetector {
public:
    explicit PauseDetector(const DetectorConfig& config = DetectorConfig{});

    /** 1 サンプル分の速度を入れる。nowMs は単調増加する時刻（ミリ秒） */
    Event update(uint32_t nowMs, float velocity);

    /** 次のレップの待ち時間を変える（ランダム待ち時間はここで毎レップ設定する） */
    void setPauseTargetMs(uint32_t ms) { config_.pauseTargetMs = ms; }

    Phase phase() const { return phase_; }
    const RepResult& lastRep() const { return lastRep_; }

private:
    DetectorConfig config_;
    Phase phase_ = Phase::Top;
    uint32_t stillStartMs_ = 0;
    uint32_t signalAtMs_ = 0;
    bool signaled_ = false;
    RepResult current_{};
    RepResult lastRep_{};

    void startAscending(uint32_t nowMs);
};

}  // namespace presscall

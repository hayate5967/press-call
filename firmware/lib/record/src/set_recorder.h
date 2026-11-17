// 判定の結果（フェーズの変化・速度・レップ完了）から、1 セット分の記録を組み立てる
//
// PauseDetector の外側で動く「記録係」。PauseDetector は変えずに、毎サンプルの
// フェーズと速度を見て、下降・挙上の時間や速度カーブを集める。
// Arduino に依存しないので、PC 上でテストできる。
//
// セットの始まり：Top から下降に入ったとき
// セットの終わり：フェーズが変わらないまま setEndIdleMs（既定 15 秒）たったとき（FR-D03）、
//                 またはレップが maxReps（API の上限 50）に達したとき
#pragma once

#include <cstdint>
#include <vector>

#include "pause_detector.h"

namespace presscall {

struct RecorderConfig {
    uint32_t sampleHz = 100;            // 速度を入れる周期（Hz）
    uint32_t setEndIdleMs = 15000;      // フェーズが変わらないままこの時間たったらセット終了
    uint32_t maxReps = 50;              // 1 セットのレップ上限（API の上限）
    uint32_t maxCurveSamples = 300;     // 1 レップの速度カーブの最大個数。超えたら間引く
    uint32_t maxCurveDecimation = 4;    // 間引きの上限（100Hz → 25Hz まで）。それでも溢れたら打ち切る
};

/** セット中に使っていた合図の設定 */
struct SetSettings {
    uint32_t settingsVersion = 0;
    Mode mode = Mode::AutoSignal;
    uint32_t pauseMinMs = 1000;  // min == max なら固定、違えばランダム
    uint32_t pauseMaxMs = 1000;
};

/** 1 レップ分の記録（API の reps[] の 1 要素に対応） */
struct RepRecord {
    RepResult result{};           // 待ち時間・静止時間・反応時間・フライング
    uint32_t startOffsetMs = 0;   // セット開始から、このレップの下降開始まで
    uint32_t eccentricMs = 0;     // 下降開始から静止まで
    uint32_t concentricMs = 0;    // 挙上開始から挙げきるまで
    float meanVelocityMps = 0.0f; // 挙上中の平均速度（MCV）
    float peakVelocityMps = 0.0f; // 挙上中の最大速度（PCV）
    uint32_t curveHz = 0;         // 速度カーブの周期（間引いたら下がる）
    std::vector<float> curve;     // 挙上中の速度カーブ
};

/** 1 セット分の記録。時刻は起動からの経過時間（uptime） */
struct SetRecord {
    SetSettings settings{};
    uint64_t startedUptimeMs = 0;  // 最初のレップの下降開始
    uint64_t endedUptimeMs = 0;    // 最後のレップを挙げきったとき
    uint64_t finishedUptimeMs = 0; // セット終了と判定したとき（保存までの時間をログに出すのに使う）
    std::vector<RepRecord> reps;
};

class SetRecorder {
public:
    explicit SetRecorder(const RecorderConfig& config = RecorderConfig{});

    /** 次のセットから使う設定（セットの途中で変えても、そのセットには反映しない） */
    void setSettings(const SetSettings& s) { settings_ = s; }

    /**
     * 1 サンプルごとに、PauseDetector::update() の後で呼ぶ。
     * セットが終わったら true を返す。レップが 1 つもないセットは捨てて false を返す
     */
    bool update(uint64_t nowMs, Phase phase, float velocity, Event event, const RepResult& lastRep);

    /** 終わったセットを取り出す（update() が true を返した直後に呼ぶ） */
    SetRecord takeFinished();

    bool inSet() const { return inSet_; }
    size_t repCount() const { return current_.reps.size(); }

    /** 直前に終わったレップ（シリアル出力用。速度カーブは入れない） */
    const RepRecord& lastRep() const { return lastRep_; }

private:
    RecorderConfig config_;
    SetSettings settings_{};

    bool inSet_ = false;
    SetRecord current_{};
    SetRecord finished_{};
    RepRecord lastRep_{};

    Phase prevPhase_ = Phase::Top;
    uint64_t lastPhaseChangeMs_ = 0;

    // レップの途中経過
    uint64_t descentStartMs_ = 0;
    uint64_t stillStartMs_ = 0;
    uint64_t ascentStartMs_ = 0;
    double ascendSum_ = 0.0;
    uint32_t ascendSamples_ = 0;
    float ascendPeak_ = 0.0f;
    std::vector<float> curve_;
    uint32_t decimation_ = 1;
    float pendingSum_ = 0.0f;
    uint32_t pendingCount_ = 0;
    bool curveFull_ = false;

    void startRep(uint64_t nowMs);
    void addCurveSample(float v);
    void completeRep(uint64_t nowMs, const RepResult& lastRep);
    bool finishSet(uint64_t nowMs);
};

}  // namespace presscall

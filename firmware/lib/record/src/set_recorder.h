// 判定の結果（フェーズの変化・速度・レップ完了）から、1 セット分の記録を組み立てる
//
// PauseDetector の外側で動く「記録係」。PauseDetector は変えずに、毎サンプルの
// フェーズと速度を見て、下降・挙上の時間や速度カーブを集める。
// Arduino に依存しないので、PC 上でテストできる。
//
// セットの区切り方は 2 通り（FR-D03、ADR-0011）。
//
// ボタンで区切る（サーバにつながっているとき。setManualAvailable(true)）
//   始まり：Web アプリで「開始」を押した時刻（startManual）。指示は最大 5 秒遅れて届くので、
//           直近 preBufferMs（30 秒）に終わったレップをためておき、押した時刻より後に下降を始めたレップを
//           さかのぼってセットに入れる
//   終わり：「終了」を押した時刻（stopManual）。それまでに挙げきったレップでセットを閉じる。
//           押し忘れ・通信切れに備え、フェーズが変わらないまま manualIdleMs（3 分）たったら自分で終える
//           （takeAutoStopped で知らせ、NetTask がサーバに伝える）
//
// 動きで区切る（つながらないあいだ。これまでの方式）
//   始まり：Top から下降に入ったとき
//   終わり：フェーズが変わらないまま setEndIdleMs（15 秒）たったとき
//
// どちらも、レップが maxReps（API の上限 50）に達したら終える。レップのないセットは送らない
#pragma once

#include <cstdint>
#include <deque>
#include <vector>

#include "pause_detector.h"

namespace presscall {

struct RecorderConfig {
    uint32_t sampleHz = 100;            // 速度を入れる周期（Hz）
    uint32_t setEndIdleMs = 15000;      // 動きで区切るとき：フェーズが変わらないままこの時間たったら終了
    uint32_t manualIdleMs = 180000;     // ボタンで区切るとき：この時間動きがなければ自分で終える（3 分）
    uint32_t preBufferMs = 30000;       // セットの外で終わったレップをためておく時間（さかのぼり用）
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
    // セットに入れるかどうかの判断用（API には送らない）
    uint64_t descentUptimeMs = 0;  // 下降を始めた時刻
    uint64_t endUptimeMs = 0;      // 挙げきった時刻
};

/** 1 セット分の記録。時刻は起動からの経過時間（uptime） */
struct SetRecord {
    SetSettings settings{};
    uint64_t startedUptimeMs = 0;  // 動きで区切る：最初のレップの下降開始。ボタン：開始を押した時刻
    uint64_t endedUptimeMs = 0;    // 最後のレップを挙げきったとき（ボタンで終えたなら終了を押した時刻）
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
     * この呼び出しでセットが終わったら true（takeFinished で取り出す）
     */
    bool update(uint64_t nowMs, Phase phase, float velocity, Event event, const RepResult& lastRep);

    /**
     * ボタンで区切れるか（サーバにつながっているか）。false のあいだは動きで区切る。
     * 途中で変わっても、今のセットはそのセットの区切り方のまま終える
     */
    void setManualAvailable(bool available) { manualAvailable_ = available; }

    /**
     * 「開始」が届いた。startUptimeMs は押した時刻（この機器の uptime に直したもの）。
     * 動きで区切ったセットの途中なら、押した時刻より前のレップでそのセットを閉じる。
     * セットが終わったら true（takeFinished で取り出す）
     */
    bool startManual(uint64_t nowMs, uint64_t startUptimeMs);

    /** 「終了」が届いた。stopUptimeMs は押した時刻。セットが終わったら true */
    bool stopManual(uint64_t nowMs, uint64_t stopUptimeMs);

    /** ボタンで始めたセットを、動きがないので自分で終えたか（1 回だけ true を返す） */
    bool takeAutoStopped();

    /** 終わったセットがあるか・取り出す（古い順） */
    bool hasFinished() const { return !finished_.empty(); }
    SetRecord takeFinished();

    bool inSet() const { return inSet_; }
    /** ボタンで始めたセットの途中か */
    bool inManualSet() const { return inSet_ && manualSet_; }
    size_t repCount() const { return current_.reps.size(); }

    /** 直前に終わったレップ（シリアル出力用。速度カーブは入れない） */
    const RepRecord& lastRep() const { return lastRep_; }

private:
    RecorderConfig config_;
    SetSettings settings_{};
    bool manualAvailable_ = false;

    bool inSet_ = false;
    bool manualSet_ = false;   // 今のセットをボタンで始めたか
    bool autoStopped_ = false;
    SetRecord current_{};
    std::deque<SetRecord> finished_;
    std::deque<RepRecord> preBuffer_;  // セットの外で終わったレップ（ボタンで区切るとき）
    RepRecord lastRep_{};

    Phase prevPhase_ = Phase::Top;
    uint64_t lastPhaseChangeMs_ = 0;

    // レップの途中経過（セットの中か外かにかかわらず数える）
    bool repInProgress_ = false;
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
    RepRecord buildRep(uint64_t nowMs, const RepResult& lastRep);
    void beginSet(uint64_t startUptimeMs, bool manual);
    void addToSet(RepRecord&& rep);
    void keepInPreBuffer(RepRecord&& rep, uint64_t nowMs);
    bool finishSet(uint64_t nowMs, uint64_t endedUptimeMs);
};

}  // namespace presscall

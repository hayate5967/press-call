#include "set_recorder.h"

#include <utility>

namespace presscall {

SetRecorder::SetRecorder(const RecorderConfig& config) : config_(config) {}

void SetRecorder::startRep(uint64_t nowMs) {
    descentStartMs_ = nowMs;
    stillStartMs_ = nowMs;
    ascentStartMs_ = nowMs;
    ascendSum_ = 0.0;
    ascendSamples_ = 0;
    ascendPeak_ = 0.0f;
    curve_.clear();
    decimation_ = 1;
    pendingSum_ = 0.0f;
    pendingCount_ = 0;
    curveFull_ = false;
}

// 挙上中の速度をカーブに足す。maxCurveSamples を超えたら 2 個ずつ平均して半分にし、
// 以降は 2 倍の間隔で記録する（ゆっくり挙げたレップでもカーブ全体を残すため）
void SetRecorder::addCurveSample(float v) {
    if (curveFull_) return;
    pendingSum_ += v;
    if (++pendingCount_ < decimation_) return;
    const float avg = pendingSum_ / static_cast<float>(pendingCount_);
    pendingSum_ = 0.0f;
    pendingCount_ = 0;

    if (curve_.size() >= config_.maxCurveSamples) {
        if (decimation_ * 2 > config_.maxCurveDecimation) {
            curveFull_ = true;  // これ以上は粗くしない。残りは打ち切る
            return;
        }
        std::vector<float> halved;
        halved.reserve(curve_.size() / 2 + 1);
        for (size_t i = 0; i + 1 < curve_.size(); i += 2) {
            halved.push_back((curve_[i] + curve_[i + 1]) / 2.0f);
        }
        curve_ = std::move(halved);
        decimation_ *= 2;
        // 今の 1 個（前の間隔ぶんのサンプルの平均）は、次の平均の材料にする
        pendingCount_ = decimation_ / 2;
        pendingSum_ = avg * static_cast<float>(pendingCount_);
        return;
    }
    curve_.push_back(avg);
}

RepRecord SetRecorder::buildRep(uint64_t nowMs, const RepResult& lastRep) {
    RepRecord rep;
    rep.result = lastRep;
    rep.descentUptimeMs = descentStartMs_;
    rep.endUptimeMs = nowMs;
    rep.eccentricMs = static_cast<uint32_t>(stillStartMs_ - descentStartMs_);
    rep.concentricMs = static_cast<uint32_t>(nowMs - ascentStartMs_);
    const float mean =
        ascendSamples_ > 0 ? static_cast<float>(ascendSum_ / ascendSamples_) : 0.0f;
    rep.meanVelocityMps = mean > 0.0f ? mean : 0.0f;  // API は 0 以上
    rep.peakVelocityMps = ascendPeak_;
    rep.curveHz = config_.sampleHz / decimation_;
    rep.curve = std::move(curve_);
    curve_.clear();
    return rep;
}

void SetRecorder::beginSet(uint64_t startUptimeMs, bool manual) {
    inSet_ = true;
    manualSet_ = manual;
    current_ = SetRecord{};
    current_.settings = settings_;
    current_.startedUptimeMs = startUptimeMs;
    current_.endedUptimeMs = startUptimeMs;
}

// セットの開始からの時刻を入れてセットに足す
void SetRecorder::addToSet(RepRecord&& rep) {
    rep.startOffsetMs = static_cast<uint32_t>(rep.descentUptimeMs - current_.startedUptimeMs);
    current_.endedUptimeMs = rep.endUptimeMs;
    current_.reps.push_back(std::move(rep));
}

// セットの外で終わったレップを、さかのぼり用にしばらく持っておく（古いものから捨てる）
void SetRecorder::keepInPreBuffer(RepRecord&& rep, uint64_t nowMs) {
    preBuffer_.push_back(std::move(rep));
    while (!preBuffer_.empty() && nowMs - preBuffer_.front().endUptimeMs > config_.preBufferMs) {
        preBuffer_.pop_front();
    }
}

bool SetRecorder::finishSet(uint64_t nowMs, uint64_t endedUptimeMs) {
    inSet_ = false;
    manualSet_ = false;
    current_.finishedUptimeMs = nowMs;
    current_.endedUptimeMs = endedUptimeMs;
    if (current_.reps.empty()) {
        current_ = SetRecord{};
        return false;  // ラックアウトの揺れだけ・押しただけなど、レップのないセットは送らない
    }
    finished_.push_back(std::move(current_));
    current_ = SetRecord{};
    return true;
}

SetRecord SetRecorder::takeFinished() {
    if (finished_.empty()) return SetRecord{};
    SetRecord out = std::move(finished_.front());
    finished_.pop_front();
    return out;
}

bool SetRecorder::takeAutoStopped() {
    const bool stopped = autoStopped_;
    autoStopped_ = false;
    return stopped;
}

bool SetRecorder::startManual(uint64_t nowMs, uint64_t startUptimeMs) {
    const uint64_t start = startUptimeMs < nowMs ? startUptimeMs : nowMs;
    bool finished = false;

    // 今のセットの途中なら閉じる。押した時刻より後に始まったレップは、新しいセットに移す
    std::vector<RepRecord> carried;
    if (inSet_) {
        std::vector<RepRecord> kept;
        for (auto& rep : current_.reps) {
            (rep.descentUptimeMs >= start ? carried : kept).push_back(std::move(rep));
        }
        current_.reps = std::move(kept);
        const uint64_t ended =
            current_.reps.empty() ? current_.startedUptimeMs : current_.reps.back().endUptimeMs;
        finished = finishSet(nowMs, ended);
    }

    beginSet(start, true);
    // さかのぼり：押した時刻より後に下降を始めたレップを、古い順に入れる
    for (auto& rep : preBuffer_) {
        if (rep.descentUptimeMs >= start) addToSet(std::move(rep));
    }
    preBuffer_.clear();
    for (auto& rep : carried) addToSet(std::move(rep));
    current_.endedUptimeMs =
        current_.reps.empty() ? start : current_.reps.back().endUptimeMs;
    // 開始の時点を「動きがあった」とみなす（押してすぐに 3 分の判定が始まらないように）
    if (lastPhaseChangeMs_ < nowMs) lastPhaseChangeMs_ = nowMs;
    return finished;
}

bool SetRecorder::stopManual(uint64_t nowMs, uint64_t stopUptimeMs) {
    if (!inManualSet()) return false;
    uint64_t stop = stopUptimeMs < nowMs ? stopUptimeMs : nowMs;
    if (stop < current_.startedUptimeMs) stop = current_.startedUptimeMs;
    // 押した時刻より後に挙げきったレップは入れない（押してから届くまでのあいだに始めたレップ）
    while (!current_.reps.empty() && current_.reps.back().endUptimeMs > stop) {
        current_.reps.pop_back();
    }
    return finishSet(nowMs, stop);
}

bool SetRecorder::update(uint64_t nowMs, Phase phase, float velocity, Event event,
                         const RepResult& lastRep) {
    const bool changed = phase != prevPhase_;
    if (changed) lastPhaseChangeMs_ = nowMs;
    bool finished = false;

    if (changed) {
        switch (phase) {
            case Phase::Descending:
                if (prevPhase_ == Phase::Top) {
                    // 動きで区切るとき（つながっていない）だけ、下降でセットを始める
                    if (!inSet_ && !manualAvailable_) beginSet(nowMs, false);
                    repInProgress_ = true;
                    startRep(nowMs);
                }
                break;
            case Phase::Still:
                stillStartMs_ = nowMs;  // 静止 → 下降 → 静止 と戻ったら、最後の静止を使う
                break;
            case Phase::Ascending:
                ascentStartMs_ = nowMs;
                break;
            default:
                break;
        }
    }
    prevPhase_ = phase;

    if (phase == Phase::Ascending && repInProgress_) {
        ascendSum_ += velocity;
        ++ascendSamples_;
        if (velocity > ascendPeak_) ascendPeak_ = velocity;
        addCurveSample(velocity);
    }

    if (event == Event::RepCompleted && repInProgress_) {
        repInProgress_ = false;
        RepRecord rep = buildRep(nowMs, lastRep);
        lastRep_ = rep;
        lastRep_.curve.clear();  // シリアル出力用なのでカーブは持たない
        if (inSet_ && rep.descentUptimeMs >= current_.startedUptimeMs) {
            addToSet(std::move(rep));
            if (current_.reps.size() >= config_.maxReps) {
                if (manualSet_) autoStopped_ = true;  // サーバにも「終わった」と伝える
                finished = finishSet(nowMs, current_.endedUptimeMs);
            }
        } else if (!inSet_) {
            keepInPreBuffer(std::move(rep), nowMs);
        }
    }

    if (inSet_) {
        const uint32_t idleLimit = manualSet_ ? config_.manualIdleMs : config_.setEndIdleMs;
        if (nowMs - lastPhaseChangeMs_ >= idleLimit) {
            // 途中のレップ（下降したまま止まっているなど）は記録しない
            repInProgress_ = false;
            if (manualSet_) autoStopped_ = true;
            finished = finishSet(nowMs, current_.endedUptimeMs) || finished;
        }
    }
    return finished;
}

}  // namespace presscall

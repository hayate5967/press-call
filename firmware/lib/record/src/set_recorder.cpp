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

void SetRecorder::completeRep(uint64_t nowMs, const RepResult& lastRep) {
    RepRecord rep;
    rep.result = lastRep;
    rep.startOffsetMs = static_cast<uint32_t>(descentStartMs_ - current_.startedUptimeMs);
    rep.eccentricMs = static_cast<uint32_t>(stillStartMs_ - descentStartMs_);
    rep.concentricMs = static_cast<uint32_t>(nowMs - ascentStartMs_);
    const float mean =
        ascendSamples_ > 0 ? static_cast<float>(ascendSum_ / ascendSamples_) : 0.0f;
    rep.meanVelocityMps = mean > 0.0f ? mean : 0.0f;  // API は 0 以上
    rep.peakVelocityMps = ascendPeak_;
    rep.curveHz = config_.sampleHz / decimation_;
    lastRep_ = rep;  // カーブを入れる前に写す
    rep.curve = std::move(curve_);
    curve_.clear();

    current_.reps.push_back(std::move(rep));
    current_.endedUptimeMs = nowMs;
}

bool SetRecorder::finishSet(uint64_t nowMs) {
    inSet_ = false;
    current_.finishedUptimeMs = nowMs;
    if (current_.reps.empty()) {
        current_ = SetRecord{};
        return false;  // ラックアウトの揺れだけなど、レップのないセットは送らない
    }
    finished_ = std::move(current_);
    current_ = SetRecord{};
    return true;
}

SetRecord SetRecorder::takeFinished() {
    SetRecord out = std::move(finished_);
    finished_ = SetRecord{};
    return out;
}

bool SetRecorder::update(uint64_t nowMs, Phase phase, float velocity, Event event,
                         const RepResult& lastRep) {
    const bool changed = phase != prevPhase_;
    if (changed) lastPhaseChangeMs_ = nowMs;

    if (changed) {
        switch (phase) {
            case Phase::Descending:
                if (prevPhase_ == Phase::Top) {
                    if (!inSet_) {
                        inSet_ = true;
                        current_ = SetRecord{};
                        current_.settings = settings_;
                        current_.startedUptimeMs = nowMs;
                    }
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

    if (phase == Phase::Ascending && inSet_) {
        ascendSum_ += velocity;
        ++ascendSamples_;
        if (velocity > ascendPeak_) ascendPeak_ = velocity;
        addCurveSample(velocity);
    }

    if (event == Event::RepCompleted && inSet_) {
        completeRep(nowMs, lastRep);
        if (current_.reps.size() >= config_.maxReps) return finishSet(nowMs);
    }

    if (inSet_ && nowMs - lastPhaseChangeMs_ >= config_.setEndIdleMs) {
        // 途中のレップ（下降したまま止まっているなど）は記録しない
        return finishSet(nowMs);
    }
    return false;
}

}  // namespace presscall

// SetRecorder のテスト（PC 上で実行：pio test -e native）
// 本物の PauseDetector に速度を入れ、その結果を SetRecorder に渡して、ファームと同じつなぎ方で確かめる
#include <unity.h>

#include "pause_detector.h"
#include "set_recorder.h"

using presscall::DetectorConfig;
using presscall::Event;
using presscall::Mode;
using presscall::PauseDetector;
using presscall::Phase;
using presscall::RecorderConfig;
using presscall::SetRecord;
using presscall::SetRecorder;
using presscall::SetSettings;

namespace {

uint64_t t = 0;
int finishedCount = 0;
SetRecord lastFinished;

// 10ms ごとに同じ速度を duration ミリ秒入れる
void feed(PauseDetector& d, SetRecorder& r, float velocity, uint32_t durationMs) {
    for (uint32_t elapsed = 0; elapsed < durationMs; elapsed += 10) {
        t += 10;
        const Event e = d.update(static_cast<uint32_t>(t), velocity);
        if (r.update(t, d.phase(), velocity, e, d.lastRep())) {
            ++finishedCount;
            lastFinished = r.takeFinished();
        }
    }
}

// 下降 0.8 秒 → 静止 1.3 秒（1.0 秒で合図）→ 挙上 0.9 秒 → ロックアウト
void oneRep(PauseDetector& d, SetRecorder& r, float upVelocity = 0.5f) {
    feed(d, r, -0.4f, 800);
    feed(d, r, 0.0f, 1300);
    feed(d, r, upVelocity, 900);
    feed(d, r, 0.0f, 100);
}

}  // namespace

void setUp() {
    t = 1000;  // 起動から 1 秒後に始める（uptime が 0 でないことも確かめる）
    finishedCount = 0;
    lastFinished = SetRecord{};
}
void tearDown() {}

void test_set_ends_after_idle_and_keeps_reps() {
    PauseDetector d;
    SetRecorder r;
    oneRep(d, r);
    oneRep(d, r);
    TEST_ASSERT_TRUE(r.inSet());
    TEST_ASSERT_EQUAL(0, finishedCount);

    feed(d, r, 0.0f, 14000);  // 14 秒ではまだ終わらない
    TEST_ASSERT_EQUAL(0, finishedCount);
    feed(d, r, 0.0f, 1100);  // 15 秒を超えたら終わる
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_FALSE(r.inSet());

    TEST_ASSERT_EQUAL(2, lastFinished.reps.size());
    TEST_ASSERT_EQUAL_UINT64(1010, lastFinished.startedUptimeMs);  // 最初の下降のサンプル
    // 終了は 2 レップ目のロックアウト。待った 15 秒は含めない
    TEST_ASSERT_TRUE(lastFinished.endedUptimeMs < lastFinished.startedUptimeMs + 7000);
    // セット終了と判定した時刻は、最後のロックアウトから 15 秒後
    TEST_ASSERT_EQUAL_UINT64(lastFinished.endedUptimeMs + 15000, lastFinished.finishedUptimeMs);
}

void test_rep_timings_and_velocity() {
    PauseDetector d;
    SetRecorder r;
    oneRep(d, r);
    oneRep(d, r);
    feed(d, r, 0.0f, 16000);
    TEST_ASSERT_EQUAL(1, finishedCount);

    const auto& rep1 = lastFinished.reps[0];
    TEST_ASSERT_EQUAL_UINT32(0, rep1.startOffsetMs);
    TEST_ASSERT_UINT32_WITHIN(20, 800, rep1.eccentricMs);
    TEST_ASSERT_UINT32_WITHIN(20, 900, rep1.concentricMs);
    TEST_ASSERT_UINT32_WITHIN(20, 1000, rep1.result.pauseTargetMs);
    TEST_ASSERT_FALSE(rep1.result.isPremature);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, rep1.meanVelocityMps);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, rep1.peakVelocityMps);
    TEST_ASSERT_EQUAL_UINT32(100, rep1.curveHz);
    TEST_ASSERT_UINT32_WITHIN(2, 90, rep1.curve.size());

    const auto& rep2 = lastFinished.reps[1];
    TEST_ASSERT_UINT32_WITHIN(20, 3100, rep2.startOffsetMs);  // 1 レップ目が約 3.1 秒
}

void test_set_without_reps_is_dropped() {
    PauseDetector d;
    SetRecorder r;
    feed(d, r, -0.4f, 500);  // ラックアウトの揺れで下降と判定されたが、レップにならない
    feed(d, r, 0.0f, 20000);
    TEST_ASSERT_EQUAL(0, finishedCount);
    TEST_ASSERT_FALSE(r.inSet());
}

void test_settings_are_captured_at_set_start() {
    PauseDetector d;
    SetRecorder r;
    SetSettings s;
    s.settingsVersion = 3;
    s.mode = Mode::AutoSignal;
    s.pauseMinMs = 500;
    s.pauseMaxMs = 1500;
    r.setSettings(s);
    oneRep(d, r);

    SetSettings changed = s;
    changed.settingsVersion = 4;
    r.setSettings(changed);  // セットの途中で変えても、このセットには反映しない
    feed(d, r, 0.0f, 16000);

    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL_UINT32(3, lastFinished.settings.settingsVersion);
    TEST_ASSERT_EQUAL_UINT32(500, lastFinished.settings.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1500, lastFinished.settings.pauseMaxMs);
}

void test_set_finishes_at_max_reps() {
    PauseDetector d;
    RecorderConfig cfg;
    cfg.maxReps = 3;
    SetRecorder r(cfg);
    oneRep(d, r);
    oneRep(d, r);
    TEST_ASSERT_EQUAL(0, finishedCount);
    oneRep(d, r);
    TEST_ASSERT_EQUAL(1, finishedCount);  // 待たずにすぐ終わる
    TEST_ASSERT_EQUAL(3, lastFinished.reps.size());

    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.5f, r.lastRep().meanVelocityMps);  // 終わった後も見られる

    oneRep(d, r);  // 次のレップは新しいセットになる
    TEST_ASSERT_TRUE(r.inSet());
    TEST_ASSERT_EQUAL(1, r.repCount());
}

void test_long_ascent_curve_is_decimated() {
    PauseDetector d;
    RecorderConfig cfg;
    cfg.maxCurveSamples = 100;  // 1 秒分
    SetRecorder r(cfg);
    feed(d, r, -0.4f, 800);
    feed(d, r, 0.0f, 1300);
    feed(d, r, 0.3f, 2500);  // 2.5 秒かけて挙げる
    feed(d, r, 0.0f, 100);
    feed(d, r, 0.0f, 16000);
    TEST_ASSERT_EQUAL(1, finishedCount);

    const auto& rep = lastFinished.reps[0];
    TEST_ASSERT_EQUAL_UINT32(25, rep.curveHz);  // 100Hz → 50Hz → 25Hz
    TEST_ASSERT_TRUE(rep.curve.size() <= 100);
    TEST_ASSERT_UINT32_WITHIN(3, 2500 / 40, rep.curve.size());  // 25Hz で 2.5 秒ぶん
    for (float v : rep.curve) TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.3f, v);
}

void test_stuck_mid_rep_ends_set_without_partial_rep() {
    PauseDetector d;
    SetRecorder r;
    oneRep(d, r);
    feed(d, r, -0.4f, 800);
    feed(d, r, 0.0f, 1300);  // 合図のあと挙げずにラックに戻した（Signaled のまま）
    feed(d, r, 0.0f, 16000);
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(1, lastFinished.reps.size());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_set_ends_after_idle_and_keeps_reps);
    RUN_TEST(test_rep_timings_and_velocity);
    RUN_TEST(test_set_without_reps_is_dropped);
    RUN_TEST(test_settings_are_captured_at_set_start);
    RUN_TEST(test_set_finishes_at_max_reps);
    RUN_TEST(test_long_ascent_curve_is_decimated);
    RUN_TEST(test_stuck_mid_rep_ends_set_without_partial_rep);
    return UNITY_END();
}

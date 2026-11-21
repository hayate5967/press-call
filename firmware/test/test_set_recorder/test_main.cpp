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


// ---- ボタンで区切る（ADR-0011） ----

void collect(SetRecorder& r) {
    while (r.hasFinished()) {
        ++finishedCount;
        lastFinished = r.takeFinished();
    }
}

void test_manual_set_uses_press_times() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    oneRep(d, r);  // 開始を押す前のレップ（入らない）
    feed(d, r, 0.0f, 20000);
    TEST_ASSERT_FALSE(r.inSet());  // つながっているあいだは、動きでセットを始めない
    TEST_ASSERT_EQUAL(0, finishedCount);

    const uint64_t pressedStart = t;
    TEST_ASSERT_FALSE(r.startManual(t, pressedStart));
    TEST_ASSERT_TRUE(r.inManualSet());
    feed(d, r, 0.0f, 2000);
    oneRep(d, r);
    oneRep(d, r);
    feed(d, r, 0.0f, 20000);  // 15 秒動かなくても、ボタンで始めたセットは終わらない
    TEST_ASSERT_TRUE(r.inManualSet());

    const uint64_t pressedStop = t;
    TEST_ASSERT_TRUE(r.stopManual(t, pressedStop));
    collect(r);
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(2, lastFinished.reps.size());
    TEST_ASSERT_EQUAL_UINT64(pressedStart, lastFinished.startedUptimeMs);
    TEST_ASSERT_EQUAL_UINT64(pressedStop, lastFinished.endedUptimeMs);
    // 1 レップ目は開始を押してから 2 秒後（＋1 サンプル）に下降を始めた
    TEST_ASSERT_UINT32_WITHIN(20, 2000, lastFinished.reps[0].startOffsetMs);
    TEST_ASSERT_FALSE(r.takeAutoStopped());
}

void test_manual_start_backfills_reps_after_press_time() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    oneRep(d, r);  // 押す前
    feed(d, r, 0.0f, 1000);
    const uint64_t pressed = t;  // ここで押したが、指示が届くのは 2 レップ後
    oneRep(d, r);
    oneRep(d, r);
    r.startManual(t, pressed);
    oneRep(d, r);
    r.stopManual(t, t);
    collect(r);
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(3, lastFinished.reps.size());
    TEST_ASSERT_EQUAL_UINT64(pressed, lastFinished.startedUptimeMs);
    TEST_ASSERT_TRUE(lastFinished.reps[0].startOffsetMs < lastFinished.reps[1].startOffsetMs);
    TEST_ASSERT_TRUE(lastFinished.reps[1].startOffsetMs < lastFinished.reps[2].startOffsetMs);
}

void test_manual_backfill_forgets_reps_older_than_buffer() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    const uint64_t pressedLongAgo = t;
    oneRep(d, r);            // 押した後だが、届くまで 40 秒かかった（ためておくのは 30 秒）
    feed(d, r, 0.0f, 40000);
    oneRep(d, r);            // これはまだためてある
    r.startManual(t, pressedLongAgo);
    r.stopManual(t, t);
    collect(r);
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(1, lastFinished.reps.size());
}

void test_manual_stop_drops_reps_after_press_time() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    r.startManual(t, t);
    oneRep(d, r);
    feed(d, r, 0.0f, 500);
    const uint64_t pressedStop = t;
    oneRep(d, r);  // 終了を押した後、指示が届く前に挙げた
    r.stopManual(t, pressedStop);
    collect(r);
    TEST_ASSERT_EQUAL(1, lastFinished.reps.size());
    TEST_ASSERT_EQUAL_UINT64(pressedStop, lastFinished.endedUptimeMs);
}

void test_manual_set_without_reps_is_dropped() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    r.startManual(t, t);
    feed(d, r, 0.0f, 3000);
    TEST_ASSERT_FALSE(r.stopManual(t, t));
    collect(r);
    TEST_ASSERT_EQUAL(0, finishedCount);
    TEST_ASSERT_FALSE(r.inSet());
}

void test_manual_set_ends_itself_after_idle() {
    PauseDetector d;
    RecorderConfig c;
    c.manualIdleMs = 60000;  // テストを短くするため 1 分にする
    SetRecorder r{c};
    r.setManualAvailable(true);
    r.startManual(t, t);
    oneRep(d, r);
    feed(d, r, 0.0f, 59000);
    TEST_ASSERT_TRUE(r.inManualSet());
    feed(d, r, 0.0f, 2000);
    TEST_ASSERT_FALSE(r.inSet());
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(1, lastFinished.reps.size());
    TEST_ASSERT_TRUE(r.takeAutoStopped());
    TEST_ASSERT_FALSE(r.takeAutoStopped());  // 1 回だけ
    // 自分で終えた後に届いた「終了」では何もしない
    TEST_ASSERT_FALSE(r.stopManual(t, t));
}

void test_manual_start_during_auto_set_splits_reps() {
    PauseDetector d;
    SetRecorder r;
    oneRep(d, r);  // つながっていないので、動きでセットが始まる
    TEST_ASSERT_TRUE(r.inSet());
    TEST_ASSERT_FALSE(r.inManualSet());
    feed(d, r, 0.0f, 1000);
    const uint64_t pressed = t;
    oneRep(d, r);  // 押した後のレップ（新しいセットに移る）
    r.setManualAvailable(true);
    TEST_ASSERT_TRUE(r.startManual(t, pressed));  // 動きで始めたセットは閉じる
    collect(r);
    TEST_ASSERT_EQUAL(1, finishedCount);
    TEST_ASSERT_EQUAL(1, lastFinished.reps.size());
    TEST_ASSERT_TRUE(r.inManualSet());
    TEST_ASSERT_EQUAL(1, r.repCount());
    r.stopManual(t, t);
    collect(r);
    TEST_ASSERT_EQUAL(2, finishedCount);
    TEST_ASSERT_EQUAL_UINT64(pressed, lastFinished.startedUptimeMs);
}

void test_manual_set_keeps_going_when_connection_is_lost() {
    PauseDetector d;
    SetRecorder r;
    r.setManualAvailable(true);
    r.startManual(t, t);
    oneRep(d, r);
    r.setManualAvailable(false);  // 途中でつながらなくなった
    feed(d, r, 0.0f, 20000);      // 15 秒動かなくても、ボタンで始めたセットのまま
    TEST_ASSERT_TRUE(r.inManualSet());
    oneRep(d, r);
    r.stopManual(t, t);
    collect(r);
    TEST_ASSERT_EQUAL(2, lastFinished.reps.size());
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
    RUN_TEST(test_manual_set_uses_press_times);
    RUN_TEST(test_manual_start_backfills_reps_after_press_time);
    RUN_TEST(test_manual_backfill_forgets_reps_older_than_buffer);
    RUN_TEST(test_manual_stop_drops_reps_after_press_time);
    RUN_TEST(test_manual_set_without_reps_is_dropped);
    RUN_TEST(test_manual_set_ends_itself_after_idle);
    RUN_TEST(test_manual_start_during_auto_set_splits_reps);
    RUN_TEST(test_manual_set_keeps_going_when_connection_is_lost);
    return UNITY_END();
}

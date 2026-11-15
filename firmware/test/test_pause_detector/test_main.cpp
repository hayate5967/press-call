// 判定ロジックのテスト（PC 上で実行：pio test -e native）
// 将来は部室で取った生データを入力にしたテストもここに足す（NFR-13）
#include <unity.h>

#include "pause_detector.h"

using presscall::DetectorConfig;
using presscall::Event;
using presscall::Mode;
using presscall::PauseDetector;
using presscall::Phase;

namespace {

// 10ms ごとに同じ速度を duration ミリ秒入れ、最後に起きたイベントを返す
uint32_t t = 0;
Event feed(PauseDetector& d, float velocity, uint32_t durationMs, Event* firstEvent = nullptr) {
    Event last = Event::None;
    for (uint32_t elapsed = 0; elapsed < durationMs; elapsed += 10) {
        t += 10;
        Event e = d.update(t, velocity);
        if (e != Event::None) {
            last = e;
            if (firstEvent && *firstEvent == Event::None) *firstEvent = e;
        }
    }
    return last;
}

}  // namespace

void setUp() { t = 0; }
void tearDown() {}

void test_auto_signal_fires_after_pause_target() {
    DetectorConfig cfg;
    cfg.pauseTargetMs = 1000;
    PauseDetector d(cfg);

    feed(d, -0.4f, 800);  // 下降
    TEST_ASSERT_EQUAL(Phase::Descending, d.phase());

    TEST_ASSERT_EQUAL(Event::None, feed(d, 0.0f, 900));  // 静止 0.9 秒：まだ合図しない
    TEST_ASSERT_EQUAL(Phase::Still, d.phase());

    TEST_ASSERT_EQUAL(Event::PressSignal, feed(d, 0.0f, 200));  // 1 秒を超えたら合図
    TEST_ASSERT_EQUAL(Phase::Signaled, d.phase());
}

void test_rep_completed_with_reaction_time() {
    PauseDetector d;
    feed(d, -0.4f, 800);
    feed(d, 0.0f, 1300);  // 1.0 秒で合図、さらに 0.3 秒待つ
    feed(d, 0.5f, 900);   // 挙上
    TEST_ASSERT_EQUAL(Event::RepCompleted, feed(d, 0.0f, 100));  // ロックアウト

    const auto& rep = d.lastRep();
    TEST_ASSERT_FALSE(rep.isPremature);
    TEST_ASSERT_EQUAL_UINT32(1000, rep.pauseTargetMs);
    TEST_ASSERT_UINT32_WITHIN(20, 1300, rep.pauseActualMs);
    TEST_ASSERT_UINT32_WITHIN(20, 300, rep.reactionMs);
}

void test_premature_lift_is_flagged() {
    PauseDetector d;
    feed(d, -0.4f, 800);
    feed(d, 0.0f, 500);  // 0.5 秒しか止まらずに挙げる
    Event first = Event::None;
    feed(d, 0.5f, 900, &first);
    TEST_ASSERT_EQUAL(Event::None, first);  // 合図は出ていない
    feed(d, 0.0f, 100);

    TEST_ASSERT_TRUE(d.lastRep().isPremature);
    TEST_ASSERT_EQUAL_UINT32(0, d.lastRep().reactionMs);
}

void test_count_only_never_signals() {
    DetectorConfig cfg;
    cfg.mode = Mode::CountOnly;
    PauseDetector d(cfg);

    feed(d, -0.4f, 800);
    Event first = Event::None;
    feed(d, 0.0f, 3000, &first);  // どれだけ止まっても合図しない
    TEST_ASSERT_EQUAL(Event::None, first);

    feed(d, 0.5f, 900);
    TEST_ASSERT_EQUAL(Event::RepCompleted, feed(d, 0.0f, 100));
    TEST_ASSERT_FALSE(d.lastRep().isPremature);
}

void test_brief_slowdown_before_chest_is_not_a_pause() {
    PauseDetector d;
    feed(d, -0.4f, 500);
    feed(d, 0.0f, 50);    // 胸に着く前に一瞬減速
    feed(d, -0.3f, 300);  // また下がる
    TEST_ASSERT_EQUAL(Phase::Descending, d.phase());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_auto_signal_fires_after_pause_target);
    RUN_TEST(test_rep_completed_with_reaction_time);
    RUN_TEST(test_premature_lift_is_flagged);
    RUN_TEST(test_count_only_never_signals);
    RUN_TEST(test_brief_slowdown_before_chest_is_not_a_pause);
    return UNITY_END();
}

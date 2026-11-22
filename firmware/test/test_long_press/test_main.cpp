// ボタンの長押しの判定のテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include "long_press.h"

using presscall::LongPress;

void setUp() {}
void tearDown() {}

void test_fires_once_after_hold() {
    LongPress p(3000);
    uint32_t t = 1000;
    TEST_ASSERT_FALSE(p.update(t, true));  // 押し始め
    for (; t < 3990; t += 10) TEST_ASSERT_FALSE(p.update(t, true));
    TEST_ASSERT_FALSE(p.update(3999, true));
    TEST_ASSERT_TRUE(p.update(4000, true));  // ちょうど 3 秒
    TEST_ASSERT_FALSE(p.update(4010, true)); // 押し続けても 2 回目は出ない
    TEST_ASSERT_FALSE(p.update(9000, true));
}

void test_short_press_does_not_fire() {
    LongPress p(3000);
    p.update(1000, true);
    p.update(2500, true);
    TEST_ASSERT_FALSE(p.update(2600, false));  // 離した
    // 離したあとは数え直す
    TEST_ASSERT_FALSE(p.update(3000, true));
    TEST_ASSERT_FALSE(p.update(5900, true));
    TEST_ASSERT_TRUE(p.update(6000, true));
}

void test_fires_again_after_release() {
    LongPress p(1000);
    p.update(0, true);
    TEST_ASSERT_TRUE(p.update(1000, true));
    p.update(1100, false);
    p.update(1200, true);
    TEST_ASSERT_TRUE(p.update(2200, true));
}

void test_millis_wraparound() {
    LongPress p(3000);
    const uint32_t start = 0xFFFFFFFFu - 1000;  // 約 49 日で millis が 0 に戻る
    p.update(start, true);
    TEST_ASSERT_FALSE(p.update(start + 2000, true));
    TEST_ASSERT_TRUE(p.update(start + 3000, true));  // 0 をまたいでも数えられる
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_fires_once_after_hold);
    RUN_TEST(test_short_press_does_not_fire);
    RUN_TEST(test_fires_again_after_release);
    RUN_TEST(test_millis_wraparound);
    return UNITY_END();
}

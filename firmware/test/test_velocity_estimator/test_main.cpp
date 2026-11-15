// 速度推定のテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <cmath>

#include "velocity_estimator.h"

using presscall::ImuSample;
using presscall::VelocityEstimator;

namespace {

constexpr int16_t kOneG = 8192;  // ±4g 設定で 1g

// 真上が +Z の向きで置いたとき、上向きに accelG [g] の加速度がかかっている状態のサンプル
ImuSample upward(float accelG) {
    return ImuSample{0, 0, static_cast<int16_t>(kOneG * (1.0f + accelG)), 2160, 1795, -255};
}

void feed(VelocityEstimator& e, const ImuSample& s, int samples) {
    for (int i = 0; i < samples; ++i) e.update(s);
}

}  // namespace

void setUp() {}
void tearDown() {}

void test_calibration_measures_gravity_and_gyro_bias() {
    VelocityEstimator e;
    feed(e, upward(0.0f), 199);
    TEST_ASSERT_FALSE(e.calibrated());
    feed(e, upward(0.0f), 1);
    TEST_ASSERT_TRUE(e.calibrated());
    TEST_ASSERT_FLOAT_WITHIN(1.0f, kOneG, e.gravityRaw());
    TEST_ASSERT_FLOAT_WITHIN(1.0f, 2160.0f, e.gyroBiasX());
}

void test_upward_push_gives_positive_velocity() {
    VelocityEstimator e;
    feed(e, upward(0.0f), 200);  // キャリブレーション
    // 上向きに 0.5g を 0.2 秒 → 理想値は 0.5 × 9.8 × 0.2 ≒ 0.98 m/s（少しずつ 0 に戻す分だけ小さくなる）
    feed(e, upward(0.5f), 20);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 0.96f, e.velocity());
}

void test_velocity_returns_to_zero_after_stop() {
    VelocityEstimator e;
    feed(e, upward(0.0f), 200);
    feed(e, upward(0.5f), 20);   // 加速
    feed(e, upward(-0.5f), 20);  // 減速
    feed(e, upward(0.0f), 20);   // 静止（ZUPT が効く）
    TEST_ASSERT_TRUE(e.zuptActive());
    TEST_ASSERT_EQUAL_FLOAT(0.0f, e.velocity());
}

void test_tilted_mount_still_measures_vertical() {
    // センサーを X 軸方向に 45°傾けて付けても、上下方向の速度が取れる
    VelocityEstimator e;
    const int16_t c = static_cast<int16_t>(kOneG * std::sqrt(0.5f));
    feed(e, ImuSample{c, 0, c, 0, 0, 0}, 200);
    const int16_t c2 = static_cast<int16_t>(kOneG * 1.5f * std::sqrt(0.5f));
    feed(e, ImuSample{c2, 0, c2, 0, 0, 0}, 20);  // 上向き 0.5g
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 0.96f, e.velocity());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_calibration_measures_gravity_and_gyro_bias);
    RUN_TEST(test_upward_push_gives_positive_velocity);
    RUN_TEST(test_velocity_returns_to_zero_after_stop);
    RUN_TEST(test_tilted_mount_still_measures_vertical);
    return UNITY_END();
}

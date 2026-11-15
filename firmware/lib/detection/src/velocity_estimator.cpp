#include "velocity_estimator.h"

#include <cmath>

namespace presscall {

namespace {
constexpr float kGravityMps2 = 9.80665f;
}

VelocityEstimator::VelocityEstimator(const EstimatorConfig& config) : config_(config) {}

void VelocityEstimator::finishCalibration() {
    const double n = static_cast<double>(calibCount_);
    const float mean[3] = {static_cast<float>(accelSum_[0] / n), static_cast<float>(accelSum_[1] / n),
                           static_cast<float>(accelSum_[2] / n)};
    const float norm = std::sqrt(mean[0] * mean[0] + mean[1] * mean[1] + mean[2] * mean[2]);
    if (norm > 1.0f) {
        // 静止中の加速度センサーは「重力と逆向き＝真上」に 1g を示す
        for (int i = 0; i < 3; ++i) up_[i] = mean[i] / norm;
        gravityRaw_ = norm;
    }
    for (int i = 0; i < 3; ++i) gyroBias_[i] = static_cast<float>(gyroSum_[i] / n);
    calibrated_ = true;
}

bool VelocityEstimator::update(const ImuSample& s) {
    if (!calibrated_) {
        accelSum_[0] += s.ax;
        accelSum_[1] += s.ay;
        accelSum_[2] += s.az;
        gyroSum_[0] += s.gx;
        gyroSum_[1] += s.gy;
        gyroSum_[2] += s.gz;
        if (++calibCount_ >= config_.calibrationSamples) finishCalibration();
        return false;
    }

    // 上下方向の加速度（m/s²）：真上の向きへの投影から重力分を引く
    const float along = s.ax * up_[0] + s.ay * up_[1] + s.az * up_[2];
    verticalAccel_ = (along - gravityRaw_) * (kGravityMps2 / gravityRaw_);

    // 角速度（ずれを引いた後）の大きさ
    const float gx = s.gx - gyroBias_[0];
    const float gy = s.gy - gyroBias_[1];
    const float gz = s.gz - gyroBias_[2];
    const float gyroMag = std::sqrt(gx * gx + gy * gy + gz * gz);

    const bool quiet =
        std::fabs(verticalAccel_) <= config_.stillAccelMps2 && gyroMag <= config_.stillGyroRaw;
    stillCount_ = quiet ? stillCount_ + 1 : 0;

    if (zuptActive()) {
        velocity_ = 0.0f;  // 止まっていると判断できる間は速度を 0 に固定する
    } else {
        velocity_ += verticalAccel_ * config_.dtSeconds;
        velocity_ *= 1.0f - config_.leakPerSecond * config_.dtSeconds;
    }
    return true;
}

}  // namespace presscall

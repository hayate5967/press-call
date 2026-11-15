// MPU-6050 の生の値から、バーの上下方向の速度（上向きが正、m/s）を推定する（ADR-003 のたたき台）
//
// 手順：
//   1. 起動直後の静止中に、加速度の平均から「真上の向き」と重力の大きさを、角速度の平均からジャイロのずれを測る
//   2. 毎サンプル、加速度を真上の向きに投影して重力分を引き、上下方向の加速度にする
//   3. それを積分して速度にする。静止を検知したら速度を 0 に戻す（ZUPT）。さらに少しずつ 0 に戻して誤差の蓄積を抑える
//
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>

namespace presscall {

struct ImuSample {
    int16_t ax, ay, az;  // 加速度の生の値
    int16_t gx, gy, gz;  // 角速度の生の値
};

struct EstimatorConfig {
    uint32_t calibrationSamples = 200;  // キャリブレーションに使うサンプル数（100Hz なら 2 秒）
    float dtSeconds = 0.01f;            // サンプル間隔
    float stillAccelMps2 = 0.25f;       // 上下方向の加速度がこれ以下なら「揺れていない」
    float stillGyroRaw = 400.0f;        // ずれを引いた角速度の大きさがこれ以下なら「回っていない」（±500°/s で約 6°/s）
    uint32_t stillSamplesForZupt = 15;  // この回数続けて揺れていなければ、速度を 0 に戻す（0.15 秒）
    float leakPerSecond = 0.5f;         // 1 秒あたり速度をこの割合だけ 0 に近づける（誤差の蓄積を抑える）
};

class VelocityEstimator {
public:
    explicit VelocityEstimator(const EstimatorConfig& config = EstimatorConfig{});

    /** 1 サンプル入れる。キャリブレーション中は false を返す */
    bool update(const ImuSample& s);

    bool calibrated() const { return calibrated_; }
    float velocity() const { return velocity_; }               // 上下方向の速度（m/s）
    float verticalAccel() const { return verticalAccel_; }     // 上下方向の加速度（m/s²、重力分を除く）
    bool zuptActive() const { return stillCount_ >= config_.stillSamplesForZupt; }

    // キャリブレーションの結果（確認用）
    float gravityRaw() const { return gravityRaw_; }
    float gyroBiasX() const { return gyroBias_[0]; }
    float gyroBiasY() const { return gyroBias_[1]; }
    float gyroBiasZ() const { return gyroBias_[2]; }

private:
    EstimatorConfig config_;
    bool calibrated_ = false;
    uint32_t calibCount_ = 0;
    double accelSum_[3] = {0, 0, 0};
    double gyroSum_[3] = {0, 0, 0};

    float up_[3] = {0, 0, 1};       // 真上の向き（単位ベクトル）
    float gravityRaw_ = 1.0f;       // 重力の大きさ（生の値）
    float gyroBias_[3] = {0, 0, 0};

    float velocity_ = 0.0f;
    float verticalAccel_ = 0.0f;
    uint32_t stillCount_ = 0;

    void finishCalibration();
};

}  // namespace presscall

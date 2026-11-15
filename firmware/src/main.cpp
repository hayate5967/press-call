// press-call ファームウェア（ステップ 3：通信なしで Press 合図まで）
//
// 動き：
//   1. 起動時にブザーと LED を 2 回鳴らす
//   2. 2 秒間静止させてキャリブレーション（真上の向き・重力・ジャイロのずれを測る）。終わると長めに 1 回鳴る
//   3. 上下方向の速度を推定し、PauseDetector で「下降 → 静止 → 合図 → 挙上」を判定する
//   4. 静止が待ち時間続いたらブザーで Press 合図。レップが終わるたびに結果をシリアルに出す
//
// 通信（テザリング・API 送信・設定の取得）は次のステップで NetTask として足す（アーキテクチャ設計 2 章）
#include <Arduino.h>
#include <Wire.h>

#include "pause_detector.h"
#include "velocity_estimator.h"

using presscall::DetectorConfig;
using presscall::EstimatorConfig;
using presscall::Event;
using presscall::ImuSample;
using presscall::Mode;
using presscall::PauseDetector;
using presscall::Phase;
using presscall::VelocityEstimator;

namespace {

// ---- 配線 ----
constexpr uint8_t kBuzzerPin = 18;       // アクティブブザーの I/O
constexpr bool kBuzzerActiveLow = true;  // 「低电平触发」のモジュールは LOW で鳴る
constexpr uint8_t kLedPin = 2;           // 基板上の LED
constexpr uint8_t kMpuAddress = 0x68;

// ---- 計測 ----
constexpr uint32_t kSamplePeriodMs = 10;  // 100Hz

// ---- 合図の設定（次のステップで API から取得する。今は固定） ----
constexpr Mode kMode = Mode::AutoSignal;
constexpr uint32_t kPauseMinMs = 1000;  // ランダムにするなら min と max を変える（例：500 と 1500）
constexpr uint32_t kPauseMaxMs = 1000;
constexpr uint32_t kSignalBeepMs = 150;

// ---- デバッグ出力 ----
constexpr bool kPrintRawCsv = false;   // true にすると生データの CSV を出す（データ取り用）
constexpr bool kPrintVelocity = true;  // true にすると 0.1 秒ごとに速度と状態を出す（しきい値の調整用）

// ===== ブザーと LED（delay を使わずに鳴らす） =====

uint32_t buzzerOffAtMs = 0;
bool buzzerOn = false;

void buzzer(bool on) {
    digitalWrite(kBuzzerPin, (on != kBuzzerActiveLow) ? HIGH : LOW);
    digitalWrite(kLedPin, on ? HIGH : LOW);
    buzzerOn = on;
}

void beepFor(uint32_t ms) {
    buzzer(true);
    buzzerOffAtMs = millis() + ms;
}

void updateBuzzer(uint32_t now) {
    if (buzzerOn && static_cast<int32_t>(now - buzzerOffAtMs) >= 0) buzzer(false);
}

// 起動時の確認用だけは止めてよいので delay を使う
void blockingBeep(uint32_t ms) {
    buzzer(true);
    delay(ms);
    buzzer(false);
}

// ===== MPU-6050 =====

void mpuWrite(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(kMpuAddress);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}

void mpuSetup() {
    mpuWrite(0x6B, 0x00);  // PWR_MGMT_1：スリープ解除
    mpuWrite(0x1C, 0x08);  // ACCEL_CONFIG：±4g（1g = 8192）
    mpuWrite(0x1B, 0x08);  // GYRO_CONFIG：±500°/s
    mpuWrite(0x1A, 0x03);  // CONFIG：ローパスフィルタ 44Hz
}

bool mpuRead(ImuSample& s) {
    Wire.beginTransmission(kMpuAddress);
    Wire.write(0x3B);  // ACCEL_XOUT_H から 14 バイト
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(kMpuAddress, static_cast<uint8_t>(14)) != 14) return false;
    // 上位バイト→下位バイトの順に読む（1 つの式で 2 回 read() すると評価順が保証されない）
    auto next = []() {
        const int hi = Wire.read();
        const int lo = Wire.read();
        return static_cast<int16_t>((hi << 8) | lo);
    };
    s.ax = next();
    s.ay = next();
    s.az = next();
    next();  // 温度は使わない
    s.gx = next();
    s.gy = next();
    s.gz = next();
    return true;
}

// ===== 判定 =====

VelocityEstimator estimator{EstimatorConfig{}};
PauseDetector detector{[] {
    DetectorConfig c;
    c.mode = kMode;
    c.pauseTargetMs = kPauseMinMs;
    return c;
}()};

uint32_t lastSampleMs = 0;
uint32_t zeroCount = 0;
uint32_t lastPrintMs = 0;
uint32_t repCount = 0;
bool wasCalibrated = false;

// 挙上中の速度を集計して、平均速度（MCV）と最大速度（PCV）を出す
float ascendSum = 0.0f;
uint32_t ascendSamples = 0;
float ascendPeak = 0.0f;

uint32_t nextPauseTargetMs() {
    if (kPauseMinMs >= kPauseMaxMs) return kPauseMinMs;
    return static_cast<uint32_t>(random(kPauseMinMs, kPauseMaxMs + 1));
}

const char* phaseName(Phase p) {
    switch (p) {
        case Phase::Top: return "top";
        case Phase::Descending: return "down";
        case Phase::Still: return "still";
        case Phase::Signaled: return "signaled";
        case Phase::Ascending: return "up";
    }
    return "?";
}

void onSample(uint32_t now, const ImuSample& s) {
    if (kPrintRawCsv) {
        Serial.printf("%lu,%d,%d,%d,%d,%d,%d\n", static_cast<unsigned long>(now), s.ax, s.ay, s.az,
                      s.gx, s.gy, s.gz);
    }

    if (!estimator.update(s)) return;  // キャリブレーション中

    if (!wasCalibrated) {
        wasCalibrated = true;
        Serial.printf("# calibrated: gravity=%.0f gyroBias=(%.0f, %.0f, %.0f)\n",
                      estimator.gravityRaw(), estimator.gyroBiasX(), estimator.gyroBiasY(),
                      estimator.gyroBiasZ());
        beepFor(400);
        detector.setPauseTargetMs(nextPauseTargetMs());
    }

    const float v = estimator.velocity();
    const Event event = detector.update(now, v);

    if (detector.phase() == Phase::Ascending) {
        ascendSum += v;
        ++ascendSamples;
        if (v > ascendPeak) ascendPeak = v;
    }

    if (event == Event::PressSignal) {
        beepFor(kSignalBeepMs);
        Serial.println("# PRESS");
    } else if (event == Event::RepCompleted) {
        const auto& rep = detector.lastRep();
        const float mcv = ascendSamples > 0 ? ascendSum / ascendSamples : 0.0f;
        Serial.printf(
            "# REP %lu: pause=%lums target=%lums reaction=%lums premature=%d MCV=%.2f PCV=%.2f\n",
            static_cast<unsigned long>(++repCount), static_cast<unsigned long>(rep.pauseActualMs),
            static_cast<unsigned long>(rep.pauseTargetMs), static_cast<unsigned long>(rep.reactionMs),
            rep.isPremature ? 1 : 0, mcv, ascendPeak);
        ascendSum = 0.0f;
        ascendSamples = 0;
        ascendPeak = 0.0f;
        detector.setPauseTargetMs(nextPauseTargetMs());
    }

    if (kPrintVelocity && now - lastPrintMs >= 100) {
        lastPrintMs = now;
        Serial.printf("v=%+.2f a=%+.2f zupt=%d phase=%s\n", v, estimator.verticalAccel(),
                      estimator.zuptActive() ? 1 : 0, phaseName(detector.phase()));
    }
}

}  // namespace

void setup() {
    buzzer(false);  // 先に「止める」値を出してから出力にする（起動直後に鳴るのを防ぐ）
    pinMode(kBuzzerPin, OUTPUT);
    pinMode(kLedPin, OUTPUT);
    buzzer(false);
    Serial.begin(115200);
    Wire.begin();
    Wire.setClock(400000);
    mpuSetup();
    randomSeed(esp_random());

    blockingBeep(100);
    delay(100);
    blockingBeep(100);

    Serial.println("# calibrating: keep the device still for 2 seconds");
    if (kPrintRawCsv) Serial.println("t_ms,ax,ay,az,gx,gy,gz");
}

void loop() {
    const uint32_t now = millis();
    updateBuzzer(now);
    if (now - lastSampleMs < kSamplePeriodMs) return;
    lastSampleMs = now;

    ImuSample s{};
    if (!mpuRead(s)) {
        Serial.println("# MPU-6050 read error");
        return;
    }

    // 加速度が全部 0 なのは、MPU-6050 がリセットされてスリープに戻ったとき。
    // 0.1 秒（10 サンプル）続いたら設定を送り直す
    if (s.ax == 0 && s.ay == 0 && s.az == 0) {
        if (++zeroCount >= 10) {
            Serial.println("# MPU-6050 reset detected, re-initializing");
            mpuSetup();
            zeroCount = 0;
        }
        return;
    }
    zeroCount = 0;

    onSample(now, s);
}

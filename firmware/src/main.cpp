// press-call ファームウェア（骨組み）
//
// 今の段階でできること：
//   1. 起動時にブザーと LED を鳴らして配線を確認する
//   2. MPU-6050 の加速度・角速度を 100Hz で読み、CSV としてシリアルに出す
//      → 部室で数セット分の生データを取り、静止判定のしきい値（ADR-003）を決めるのに使う
//
// 次の段階：速度の推定 → PauseDetector で判定 → 合図、送信は NetTask（アーキテクチャ設計 2 章）
#include <Arduino.h>
#include <Wire.h>

#include "pause_detector.h"

namespace {

constexpr uint8_t kBuzzerPin = 25;  // アクティブブザーの I/O（配線に合わせて変える）
constexpr uint8_t kLedPin = 2;      // 基板上の LED
constexpr uint8_t kMpuAddress = 0x68;
constexpr uint32_t kSamplePeriodMs = 10;  // 100Hz

void beep(uint32_t ms) {
    digitalWrite(kBuzzerPin, HIGH);
    digitalWrite(kLedPin, HIGH);
    delay(ms);
    digitalWrite(kBuzzerPin, LOW);
    digitalWrite(kLedPin, LOW);
}

void mpuWrite(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(kMpuAddress);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}

void mpuSetup() {
    mpuWrite(0x6B, 0x00);  // PWR_MGMT_1：スリープ解除
    mpuWrite(0x1C, 0x08);  // ACCEL_CONFIG：±4g
    mpuWrite(0x1B, 0x08);  // GYRO_CONFIG：±500°/s
    mpuWrite(0x1A, 0x03);  // CONFIG：ローパスフィルタ 44Hz
}

struct RawSample {
    int16_t ax, ay, az, gx, gy, gz;
};

bool mpuRead(RawSample& s) {
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

uint32_t lastSampleMs = 0;

}  // namespace

void setup() {
    pinMode(kBuzzerPin, OUTPUT);
    pinMode(kLedPin, OUTPUT);
    Serial.begin(115200);
    Wire.begin();
    Wire.setClock(400000);
    mpuSetup();

    beep(100);
    delay(100);
    beep(100);

    Serial.println("t_ms,ax,ay,az,gx,gy,gz");
}

void loop() {
    const uint32_t now = millis();
    if (now - lastSampleMs < kSamplePeriodMs) return;
    lastSampleMs = now;

    RawSample s{};
    if (!mpuRead(s)) {
        Serial.println("# MPU-6050 read error");
        return;
    }
    Serial.printf("%lu,%d,%d,%d,%d,%d,%d\n", static_cast<unsigned long>(now), s.ax, s.ay, s.az,
                  s.gx, s.gy, s.gz);
}

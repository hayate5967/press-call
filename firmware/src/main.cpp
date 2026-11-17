// press-call ファームウェア（ステップ 4：セットの送信と再送）
//
// 動き：
//   1. 起動時にブザーと LED を 2 回鳴らす
//   2. 2 秒間静止させてキャリブレーション（真上の向き・重力・ジャイロのずれを測る）。終わると長めに 1 回鳴る
//   3. 上下方向の速度を推定し、PauseDetector で「下降 → 静止 → 合図 → 挙上」を判定する
//   4. 静止が待ち時間続いたらブザーで Press 合図。レップが終わるたびに結果をシリアルに出す
//   5. 15 秒動きがなければセット終了。記録を StorageTask に渡してすぐ LittleFS に保存し、NetTask が API に送る
//   6. モード・待ち時間（固定 / ランダム）・静止のしきい値は API から取る（NetTask が 5 秒おきに問い合わせる）。
//      新しい設定はセットの合間にだけ反映する。取れないときは前回保存した設定、それもなければ既定値で動く
//
// コアの分担（アーキテクチャ設計 2 章、NFR-01・02）：
//   コア 1：計測タスク（10ms ごとに読む・判定・合図・セットの記録）。通信もフラッシュへの書き込みも待たない
//   コア 0：StorageTask（セットを LittleFS に保存。優先度 2）。storage_task.cpp
//           NetTask（テザリング・NTP・送信・再送・設定の取得。優先度 1）。net_task.cpp
//   計測とコア 0 のタスクは FreeRTOS のキューでだけやり取りする
#include <Arduino.h>
#include <Wire.h>
#include <esp_timer.h>

#include <memory>

#include "net_task.h"
#include "pause_detector.h"
#include "secrets_include.h"
#include "set_recorder.h"
#include "set_store.h"
#include "settings_codec.h"
#include "storage_task.h"
#include "velocity_estimator.h"

using presscall::DetectorConfig;
using presscall::DeviceSettings;
using presscall::EstimatorConfig;
using presscall::Event;
using presscall::ImuSample;
using presscall::Mode;
using presscall::PauseDetector;
using presscall::Phase;
using presscall::SetRecord;
using presscall::SetRecorder;
using presscall::VelocityEstimator;

namespace {

// ---- 配線 ----
constexpr uint8_t kBuzzerPin = 18;       // アクティブブザーの I/O
constexpr bool kBuzzerActiveLow = true;  // 「低电平触发」のモジュールは LOW で鳴る
constexpr uint8_t kLedPin = 2;           // 基板上の LED
constexpr uint8_t kMpuAddress = 0x68;

// ---- 計測 ----
constexpr uint32_t kSamplePeriodMs = 10;  // 100Hz
constexpr uint32_t kMeasureStackBytes = 8 * 1024;
constexpr UBaseType_t kMeasurePriority = 5;  // NetTask（1）より高く、計測を優先する
constexpr BaseType_t kMeasureCore = 1;

// ---- 合図 ----
constexpr uint32_t kSignalBeepMs = 150;

// ---- デバッグ出力 ----
constexpr bool kPrintRawCsv = false;    // true にすると生データの CSV を出す（データ取り用）
constexpr bool kPrintVelocity = true;   // true にすると 0.1 秒ごとに速度と状態を出す（しきい値の調整用）

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

// ===== 判定とセットの記録 =====

// 今使っている設定（計測タスクだけが触る。setup() で決め、以降はセットの合間に NetTask から受け取る）
DeviceSettings settings = presscall::defaultDeviceSettings();

DetectorConfig detectorConfig() {
    DetectorConfig c;
    c.mode = settings.set.mode;
    c.pauseTargetMs = settings.set.pauseMinMs;
    // 静止のしきい値（API の stillThreshold）。範囲外の値は settings_codec が既定値に直し、NetTask が警告を出す
    if (settings.hasStillThreshold) c.stillVelocity = settings.stillThreshold;
    return c;
}

VelocityEstimator estimator{EstimatorConfig{}};
PauseDetector detector{detectorConfig()};
SetRecorder recorder{};
bool reportedInSet = false;

uint32_t zeroCount = 0;
uint32_t lastPrintMs = 0;
bool wasCalibrated = false;

// 次のレップの待ち時間。固定なら min == max、ランダムなら範囲から毎レップ選ぶ（FR-D05）
uint32_t nextPauseTargetMs() {
    const uint32_t lo = settings.set.pauseMinMs;
    const uint32_t hi = settings.set.pauseMaxMs;
    if (lo >= hi) return lo;
    return static_cast<uint32_t>(random(lo, hi + 1));
}

void printSettings(const char* label) {
    if (settings.set.mode == Mode::CountOnly) {
        Serial.printf("# %s v%lu: count_only", label,
                      static_cast<unsigned long>(settings.set.settingsVersion));
    } else if (settings.set.pauseMinMs == settings.set.pauseMaxMs) {
        Serial.printf("# %s v%lu: auto_signal fixed %lums", label,
                      static_cast<unsigned long>(settings.set.settingsVersion),
                      static_cast<unsigned long>(settings.set.pauseMinMs));
    } else {
        Serial.printf("# %s v%lu: auto_signal random %lu-%lums", label,
                      static_cast<unsigned long>(settings.set.settingsVersion),
                      static_cast<unsigned long>(settings.set.pauseMinMs),
                      static_cast<unsigned long>(settings.set.pauseMaxMs));
    }
    if (settings.hasStillThreshold) {
        Serial.printf(" still=%.3f\n", settings.stillThreshold);
    } else {
        Serial.println(" still=default");
    }
}

// 設定を判定と記録に反映する。セットの合間（判定が Top）でだけ呼ぶ
void applySettings(const DeviceSettings& s) {
    settings = s;
    recorder.setSettings(s.set);
    detector = PauseDetector{detectorConfig()};  // モードとしきい値は作り直して変える
    detector.setPauseTargetMs(nextPauseTargetMs());
}

// NetTask から新しい設定が届いていれば、セットの合間に反映する
void pickUpNewSettings() {
    if (recorder.inSet() || detector.phase() != Phase::Top) return;
    DeviceSettings fresh;
    if (!presscall::net::takeNewSettings(fresh)) return;
    applySettings(fresh);
    printSettings("settings applied");
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

void onSetFinished() {
    auto set = std::make_unique<SetRecord>(recorder.takeFinished());
    const unsigned reps = static_cast<unsigned>(set->reps.size());
    // StorageTask に渡すだけ。保存（フラッシュへの書き込み）は向こうで行うので、ここでは待たない
    if (presscall::storage::submit(std::move(set))) {
        Serial.printf("# SET END: %u reps -> StorageTask\n", reps);
    } else {
        Serial.printf("# SET END: %u reps, but StorageTask queue is full. Set lost\n", reps);
    }
    // 下降や合図のまま止まってセットが終わったときは、判定を最初（Top）に戻す
    if (detector.phase() != Phase::Top) {
        detector = PauseDetector{detectorConfig()};
        detector.setPauseTargetMs(nextPauseTargetMs());
    }
}

void onSample(uint64_t nowUptime, const ImuSample& s) {
    const uint32_t now = static_cast<uint32_t>(nowUptime);
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

    // 合図は記録より先に出す（NFR-01）
    if (event == Event::PressSignal) {
        beepFor(kSignalBeepMs);
        Serial.println("# PRESS");
    }

    const bool setFinished =
        recorder.update(nowUptime, detector.phase(), v, event, detector.lastRep());

    if (event == Event::RepCompleted) {
        const auto& rep = recorder.lastRep();
        Serial.printf(
            "# REP: pause=%lums target=%lums reaction=%lums premature=%d ecc=%lums con=%lums "
            "MCV=%.2f PCV=%.2f\n",
            static_cast<unsigned long>(rep.result.pauseActualMs),
            static_cast<unsigned long>(rep.result.pauseTargetMs),
            static_cast<unsigned long>(rep.result.reactionMs), rep.result.isPremature ? 1 : 0,
            static_cast<unsigned long>(rep.eccentricMs),
            static_cast<unsigned long>(rep.concentricMs), rep.meanVelocityMps, rep.peakVelocityMps);
        detector.setPauseTargetMs(nextPauseTargetMs());
    }

    if (setFinished) onSetFinished();

    // セット中かどうかが変わったら NetTask に知らせる（セット中は設定を問い合わせない）
    if (recorder.inSet() != reportedInSet) {
        reportedInSet = recorder.inSet();
        presscall::net::setInSet(reportedInSet);
    }
    pickUpNewSettings();

    if (kPrintVelocity && now - lastPrintMs >= 100) {
        lastPrintMs = now;
        Serial.printf("v=%+.2f a=%+.2f zupt=%d phase=%s\n", v, estimator.verticalAccel(),
                      estimator.zuptActive() ? 1 : 0, phaseName(detector.phase()));
    }
}

void measureOnce() {
    const uint64_t nowUptime = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    updateBuzzer(static_cast<uint32_t>(nowUptime));

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

    onSample(nowUptime, s);
}

// 周期が乱れたサンプル（前回から 2 周期以上空いた）を数え、1 秒ごとにまとめてログに出す。
// フラッシュの書き込み中は両方のコアでフラッシュ上のコードが止まることがあるので、実機で影響を確かめる用
uint32_t lateCount = 0;
uint32_t lateMaxGapMs = 0;
uint32_t lateReportAtMs = 0;

void checkSamplePeriod(uint64_t nowUptime, uint64_t& lastUptime) {
    const uint32_t gap = static_cast<uint32_t>(nowUptime - lastUptime);
    lastUptime = nowUptime;
    if (gap >= 2 * kSamplePeriodMs) {
        ++lateCount;
        if (gap > lateMaxGapMs) lateMaxGapMs = gap;
    }
    const uint32_t now = static_cast<uint32_t>(nowUptime);
    if (lateCount > 0 && static_cast<int32_t>(now - lateReportAtMs) >= 1000) {
        Serial.printf("# MEASURE late samples: %lu in last 1s, max gap %lums\n",
                      static_cast<unsigned long>(lateCount),
                      static_cast<unsigned long>(lateMaxGapMs));
        lateCount = 0;
        lateMaxGapMs = 0;
        lateReportAtMs = now;
    }
}

// コア 1 の計測タスク。10ms ごとに起きる（vTaskDelayUntil で周期を守る）
void measureTask(void*) {
    TickType_t lastWake = xTaskGetTickCount();
    uint64_t lastUptime = static_cast<uint64_t>(esp_timer_get_time() / 1000);
    for (;;) {
        checkSamplePeriod(static_cast<uint64_t>(esp_timer_get_time() / 1000), lastUptime);
        measureOnce();
        vTaskDelayUntil(&lastWake, pdMS_TO_TICKS(kSamplePeriodMs));
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

    // LittleFS はタスクを作る前にマウントする
    if (!presscall::store::begin()) {
        Serial.println("# ERROR: LittleFS mount failed. Sets and settings will not be saved");
    }
    // 前回取った設定で始める（FR-D10）。なければ既定値（自動合図・固定 1.0 秒）。
    // 別のトークン（作り直したデバイスなど）で取った設定は使わない
    DeviceSettings saved;
    if (presscall::store::loadSettings(presscall::net::deviceTokenFingerprint(), saved)) {
        applySettings(saved);
        printSettings("settings loaded");
    } else {
        applySettings(presscall::defaultDeviceSettings());
        printSettings("settings default");
    }

    blockingBeep(100);
    delay(100);
    blockingBeep(100);

    if (PRESSCALL_SECRETS_ARE_PLACEHOLDERS) {
        Serial.println("# WARNING: include/secrets.h is missing. Sets are saved but not sent");
    }
    if (!presscall::storage::start()) Serial.println("# ERROR: failed to start StorageTask");
    if (!presscall::net::start(settings)) Serial.println("# ERROR: failed to start NetTask");

    Serial.println("# calibrating: keep the device still for 2 seconds");
    if (kPrintRawCsv) Serial.println("t_ms,ax,ay,az,gx,gy,gz");

    xTaskCreatePinnedToCore(measureTask, "Measure", kMeasureStackBytes, nullptr, kMeasurePriority,
                            nullptr, kMeasureCore);
}

void loop() {
    // 仕事は計測タスクと NetTask に任せたので、Arduino の loop タスクは消す
    vTaskDelete(nullptr);
}

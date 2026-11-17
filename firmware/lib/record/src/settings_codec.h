// GET /device/settings の応答を読む・LittleFS に保存する形に変換する（API 仕様書 5 章、FR-D10）
//
// 応答の例：
//   {"version":4,"mode":"auto_signal","pause":{"mode":"random","minMs":500,"maxMs":1500},"stillThreshold":null}
// 知らないキーは読み飛ばす（API に項目が増えても動き続けるように）。
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>
#include <string>

#include "set_recorder.h"

namespace presscall {

/** 待ち時間の範囲（API の入力ルールと同じ。packages/shared の PAUSE_MIN_MS・PAUSE_MAX_MS） */
constexpr uint32_t kPauseLimitMinMs = 200;
constexpr uint32_t kPauseLimitMaxMs = 5000;

/**
 * 静止のしきい値（m/s）の上限（この値は含まない）。「動き出した」とみなす速さと同じ。
 * これ以上だと静止と動き出しの判定が重なるので使わない（ADR-0003。packages/shared の STILL_THRESHOLD_MAX_MPS と同じ値）
 */
constexpr float kStillThresholdMaxMps = DetectorConfig{}.moveVelocity;

/** デバイスの設定。FreeRTOS のキューでそのまま受け渡せるよう、ポインタを持たない形にしている */
struct DeviceSettings {
    SetSettings set{};                // version・モード・待ち時間（固定なら min == max）
    bool hasStillThreshold = false;   // false ならファームの既定値を使う
    float stillThreshold = 0.0f;      // 静止とみなす速さ（m/s）
};

/** 設定を取れないとき（初回起動でオフラインなど）に使う値。API の初期設定と同じ（自動合図・固定 1.0 秒） */
DeviceSettings defaultDeviceSettings();

/** 静止のしきい値として使える値か（0 より大きく kStillThresholdMaxMps 未満） */
bool isUsableStillThreshold(float v);

/** 中身がルールどおりか（待ち時間が 200〜5000ms で min ≦ max、しきい値は使える値） */
bool isValidSettings(const DeviceSettings& s);

/**
 * 応答の JSON を読む。形が違う・ルール違反なら false（out は変えない）。
 * stillThreshold だけは範囲外でも全体を捨てず、ファームの既定値を使う（hasStillThreshold = false）。
 * そのとき stillIgnored が true になるので、呼び出し側で警告を出す
 */
bool parseSettingsJson(const std::string& json, DeviceSettings& out, bool* stillIgnored = nullptr);

/**
 * デバイストークンの指紋（FNV-1a の 32 ビット）。保存した設定がどのトークンで取ったものかを見分けるのに使う。
 * トークンそのものは保存しない
 */
uint32_t tokenFingerprint(const char* token);

/** LittleFS に保存する 1 行（改行なし）。取ったときのトークンの指紋も入れる */
std::string encodeSettingsLine(const DeviceSettings& s, uint32_t fingerprint);

/**
 * 保存した 1 行を読む。壊れている、または別のトークン（作り直したデバイスなど）で取った設定なら false。
 * version はデバイスごとの番号なので、別のデバイスの設定を version だけで比べると取り違える
 */
bool decodeSettingsLine(const std::string& line, uint32_t fingerprint, DeviceSettings& out);

}  // namespace presscall

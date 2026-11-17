#include "settings_codec.h"

#include "json_reader.h"

#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace presscall {

namespace {

using json::Reader;

bool toUint32(double v, uint32_t& out) {
    if (v < 0 || v > 4294967295.0 || std::floor(v) != v) return false;
    out = static_cast<uint32_t>(v);
    return true;
}

// "pause" の値（null か、固定・ランダムのオブジェクト）
bool parsePause(Reader& r, bool& isNull, uint32_t& minMs, uint32_t& maxMs) {
    if (r.literal("null")) {
        isNull = true;
        return true;
    }
    isNull = false;
    if (!r.consume('{')) return false;
    std::string mode;
    double fixedMs = -1, lo = -1, hi = -1;
    if (!r.consume('}')) {
        do {
            std::string key;
            if (!r.string(key) || !r.consume(':')) return false;
            if (key == "mode") {
                if (!r.string(mode)) return false;
            } else if (key == "fixedMs") {
                if (!r.number(fixedMs)) return false;
            } else if (key == "minMs") {
                if (!r.number(lo)) return false;
            } else if (key == "maxMs") {
                if (!r.number(hi)) return false;
            } else if (!r.skipValue()) {
                return false;
            }
        } while (r.consume(','));
        if (!r.consume('}')) return false;
    }
    if (mode == "fixed") {
        if (!toUint32(fixedMs, minMs)) return false;
        maxMs = minMs;
        return true;
    }
    if (mode == "random") return toUint32(lo, minMs) && toUint32(hi, maxMs);
    return false;
}

}  // namespace

DeviceSettings defaultDeviceSettings() {
    DeviceSettings s;
    s.set.settingsVersion = 0;  // まだ API から取っていない
    s.set.mode = Mode::AutoSignal;
    s.set.pauseMinMs = 1000;
    s.set.pauseMaxMs = 1000;
    return s;
}

bool isUsableStillThreshold(float v) {
    return std::isfinite(v) && v > 0.0f && v < kStillThresholdMaxMps;
}

bool isValidSettings(const DeviceSettings& s) {
    if (s.hasStillThreshold && !isUsableStillThreshold(s.stillThreshold)) return false;
    if (s.set.mode == Mode::CountOnly) return true;
    return s.set.pauseMinMs >= kPauseLimitMinMs && s.set.pauseMaxMs <= kPauseLimitMaxMs &&
           s.set.pauseMinMs <= s.set.pauseMaxMs;
}

bool parseSettingsJson(const std::string& json, DeviceSettings& out, bool* stillIgnored) {
    Reader r(json);
    bool ignored = false;
    if (!r.consume('{')) return false;

    DeviceSettings s;
    bool hasVersion = false, hasMode = false, hasPause = false, pauseIsNull = true;
    std::string mode;
    if (!r.consume('}')) {
        do {
            std::string key;
            if (!r.string(key) || !r.consume(':')) return false;
            if (key == "version") {
                double v;
                if (!r.number(v) || !toUint32(v, s.set.settingsVersion)) return false;
                hasVersion = true;
            } else if (key == "mode") {
                if (!r.string(mode)) return false;
                hasMode = true;
            } else if (key == "pause") {
                if (!parsePause(r, pauseIsNull, s.set.pauseMinMs, s.set.pauseMaxMs)) return false;
                hasPause = true;
            } else if (key == "stillThreshold") {
                if (r.literal("null")) {
                    s.hasStillThreshold = false;
                } else {
                    double v;
                    if (!r.number(v)) return false;
                    if (isUsableStillThreshold(static_cast<float>(v))) {
                        s.hasStillThreshold = true;
                        s.stillThreshold = static_cast<float>(v);
                    } else {
                        // 範囲外は既定値を使う。待ち時間などほかの設定は活かす
                        s.hasStillThreshold = false;
                        ignored = true;
                    }
                }
            } else if (!r.skipValue()) {
                return false;
            }
        } while (r.consume(','));
        if (!r.consume('}')) return false;
    }
    if (!r.atEnd() || !hasVersion || !hasMode || !hasPause) return false;

    if (mode == "auto_signal") {
        if (pauseIsNull) return false;  // 自動合図なら待ち時間が必要
        s.set.mode = Mode::AutoSignal;
    } else if (mode == "count_only") {
        if (!pauseIsNull) return false;
        s.set.mode = Mode::CountOnly;
        s.set.pauseMinMs = 0;
        s.set.pauseMaxMs = 0;
    } else {
        return false;
    }
    if (!isValidSettings(s)) return false;
    out = s;
    if (stillIgnored) *stillIgnored = ignored;
    return true;
}

uint32_t tokenFingerprint(const char* token) {
    uint32_t h = 2166136261u;
    for (const char* p = token; *p; ++p) {
        h ^= static_cast<uint8_t>(*p);
        h *= 16777619u;
    }
    return h;
}

// しきい値は %.9g で書く（float を桁落ちなしで書き戻せる桁数）
std::string encodeSettingsLine(const DeviceSettings& s, uint32_t fingerprint) {
    char out[112];
    std::snprintf(out, sizeof(out),
                  "PST2 %08" PRIx32 " %" PRIu32 " %c %" PRIu32 " %" PRIu32 " %d %.9g",
                  fingerprint, s.set.settingsVersion, s.set.mode == Mode::AutoSignal ? 'A' : 'C',
                  s.set.pauseMinMs, s.set.pauseMaxMs, s.hasStillThreshold ? 1 : 0,
                  static_cast<double>(s.hasStillThreshold ? s.stillThreshold : 0.0f));
    return out;
}

bool decodeSettingsLine(const std::string& line, uint32_t fingerprint, DeviceSettings& out) {
    DeviceSettings s;
    uint32_t savedFingerprint = 0;
    char mode = 0;
    int hasStill = 0;
    int consumed = 0;
    const int n = std::sscanf(line.c_str(),
                              "PST2 %8" SCNx32 " %" SCNu32 " %c %" SCNu32 " %" SCNu32 " %d %f%n",
                              &savedFingerprint, &s.set.settingsVersion, &mode, &s.set.pauseMinMs,
                              &s.set.pauseMaxMs, &hasStill, &s.stillThreshold, &consumed);
    if (n != 7 || static_cast<size_t>(consumed) != line.size()) return false;
    if (savedFingerprint != fingerprint) return false;  // 別のトークンで取った設定
    if ((mode != 'A' && mode != 'C') || (hasStill != 0 && hasStill != 1)) return false;
    s.set.mode = mode == 'A' ? Mode::AutoSignal : Mode::CountOnly;
    s.hasStillThreshold = hasStill == 1;
    if (!s.hasStillThreshold) s.stillThreshold = 0.0f;
    if (!isValidSettings(s)) return false;
    out = s;
    return true;
}

}  // namespace presscall

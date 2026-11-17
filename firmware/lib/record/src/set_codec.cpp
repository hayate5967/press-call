#include "set_codec.h"

#include <cinttypes>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>

namespace presscall {

namespace {

void appendf(std::string& out, const char* fmt, ...) __attribute__((format(printf, 2, 3)));

// printf の書式で out の末尾に足す（ここで作る断片はどれも短いので 128 バイトで足りる）
void appendf(std::string& out, const char* fmt, ...) {
    char buf[128];
    va_list args;
    va_start(args, fmt);
    const int n = std::vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (n > 0) out.append(buf, static_cast<size_t>(n) < sizeof(buf) ? n : sizeof(buf) - 1);
}

void appendNullableMs(std::string& out, const char* key, bool present, uint32_t value) {
    if (present) {
        appendf(out, "\"%s\":%" PRIu32, key, value);
    } else {
        appendf(out, "\"%s\":null", key);
    }
}

// 平均・最大速度。NaN などは null にする（API の入力チェックで弾かれて再送不能になるのを防ぐ）
void appendVelocity(std::string& out, const char* key, float v) {
    if (std::isfinite(v)) {
        appendf(out, "\"%s\":%.3f", key, static_cast<double>(v));
    } else {
        appendf(out, "\"%s\":null", key);
    }
}

std::string encodeCurve(const std::vector<float>& curve) {
    std::string s = "[";
    for (size_t i = 0; i < curve.size(); ++i) {
        if (i > 0) s += ',';
        const float v = std::isfinite(curve[i]) ? curve[i] : 0.0f;
        appendf(s, "%.2f", static_cast<double>(v));
    }
    s += ']';
    return s;
}

// 1970-01-01 からの日数を年月日にする（Howard Hinnant の civil_from_days）
void civilFromDays(int64_t z, int& year, unsigned& month, unsigned& day) {
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t y = static_cast<int64_t>(yoe) + era * 400;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    day = doy - (153 * mp + 2) / 5 + 1;
    month = mp < 10 ? mp + 3 : mp - 9;
    year = static_cast<int>(y + (month <= 2 ? 1 : 0));
}

int64_t floorDiv(int64_t a, int64_t b) { return a / b - ((a % b != 0) && ((a < 0) != (b < 0))); }

}  // namespace

std::string formatUuidV4(const uint8_t random[16]) {
    uint8_t b[16];
    std::memcpy(b, random, 16);
    b[6] = static_cast<uint8_t>((b[6] & 0x0F) | 0x40);  // 版 4（乱数で作った UUID）
    b[8] = static_cast<uint8_t>((b[8] & 0x3F) | 0x80);  // 変種（RFC 9562）
    char out[37];
    std::snprintf(out, sizeof(out),
                  "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0],
                  b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13],
                  b[14], b[15]);
    return out;
}

std::string formatIso8601Utc(int64_t epochMs) {
    const int64_t secs = floorDiv(epochMs, 1000);
    const int ms = static_cast<int>(epochMs - secs * 1000);
    const int64_t days = floorDiv(secs, 86400);
    const int secOfDay = static_cast<int>(secs - days * 86400);
    int year;
    unsigned month, day;
    civilFromDays(days, year, month, day);
    char out[48];  // 年が 4 桁を超えても切れないように余裕を持たせる
    std::snprintf(out, sizeof(out), "%04d-%02u-%02uT%02d:%02d:%02d.%03dZ", year, month, day,
                  secOfDay / 3600, (secOfDay / 60) % 60, secOfDay % 60, ms);
    return out;
}

std::string encodeRepsJson(const SetRecord& set, size_t budget) {
    const bool autoSignal = set.settings.mode == Mode::AutoSignal;
    std::string out = "[";
    for (size_t i = 0; i < set.reps.size(); ++i) {
        const RepRecord& r = set.reps[i];
        std::string rep;
        rep.reserve(320);
        appendf(rep, "{\"index\":%u,", static_cast<unsigned>(i + 1));
        appendf(rep, "\"startOffsetMs\":%" PRIu32 ",", r.startOffsetMs);
        appendf(rep, "\"eccentricMs\":%" PRIu32 ",", r.eccentricMs);
        // 回数記録モードには合図がないので、待ち時間・反応時間は null、フライングは false（API の入力ルール）
        appendNullableMs(rep, "pauseTargetMs", autoSignal, r.result.pauseTargetMs);
        rep += ',';
        appendf(rep, "\"pauseActualMs\":%" PRIu32 ",", r.result.pauseActualMs);
        // フライングのときは反応時間がない
        appendNullableMs(rep, "reactionMs", autoSignal && !r.result.isPremature,
                         r.result.reactionMs);
        rep += ',';
        appendf(rep, "\"isPremature\":%s,",
                autoSignal && r.result.isPremature ? "true" : "false");
        appendf(rep, "\"concentricMs\":%" PRIu32 ",", r.concentricMs);
        appendVelocity(rep, "meanVelocityMps", r.meanVelocityMps);
        rep += ',';
        appendVelocity(rep, "peakVelocityMps", r.peakVelocityMps);
        rep += ',';

        // 残りのレップをカーブなしで書く余地を残しつつ、入るならカーブを付ける
        const size_t reserveForRest = (set.reps.size() - i) * 400;
        std::string curve = r.curve.empty() || r.curveHz == 0 ? "" : encodeCurve(r.curve);
        const bool fits =
            !curve.empty() && out.size() + rep.size() + curve.size() + reserveForRest <= budget;
        if (fits) {
            appendf(rep, "\"curveHz\":%" PRIu32 ",\"velocityCurve\":", r.curveHz);
            rep += curve;
        } else {
            rep += "\"curveHz\":null,\"velocityCurve\":null";
        }
        rep += '}';

        if (i > 0) out += ',';
        out += rep;
    }
    out += ']';
    return out;
}

std::string encodeHeader(const StoredSetHeader& h) {
    char out[192];
    std::snprintf(out, sizeof(out),
                  "PCS1 %s %" PRIu32 " %" PRIu64 " %" PRIu64 " %" PRId64 " %" PRIu32
                  " %c %" PRIu32 " %" PRIu32,
                  h.clientSetId.c_str(), h.bootId, h.startedUptimeMs, h.endedUptimeMs,
                  h.startedEpochMs, h.settings.settingsVersion,
                  h.settings.mode == Mode::AutoSignal ? 'A' : 'C', h.settings.pauseMinMs,
                  h.settings.pauseMaxMs);
    return out;
}

bool decodeHeader(const std::string& line, StoredSetHeader& out) {
    char id[40] = {};
    char mode = 0;
    StoredSetHeader h;
    int consumed = 0;
    const int n = std::sscanf(line.c_str(),
                              "PCS1 %39s %" SCNu32 " %" SCNu64 " %" SCNu64 " %" SCNd64 " %" SCNu32
                              " %c %" SCNu32 " %" SCNu32 "%n",
                              id, &h.bootId, &h.startedUptimeMs, &h.endedUptimeMs,
                              &h.startedEpochMs, &h.settings.settingsVersion, &mode,
                              &h.settings.pauseMinMs, &h.settings.pauseMaxMs, &consumed);
    if (n != 9 || static_cast<size_t>(consumed) != line.size()) return false;
    if (std::strlen(id) != 36 || (mode != 'A' && mode != 'C')) return false;
    if (h.endedUptimeMs < h.startedUptimeMs) return false;
    h.clientSetId = id;
    h.settings.mode = mode == 'A' ? Mode::AutoSignal : Mode::CountOnly;
    out = h;
    return true;
}

std::string buildSetBody(const StoredSetHeader& h, int64_t startedEpochMs,
                         const std::string& repsJson) {
    const int64_t endedEpochMs =
        startedEpochMs + static_cast<int64_t>(h.endedUptimeMs - h.startedUptimeMs);
    std::string body;
    body.reserve(repsJson.size() + 400);
    body += "{\"clientSetId\":\"";
    body += h.clientSetId;
    body += "\",";
    appendf(body, "\"settingsVersion\":%" PRIu32 ",", h.settings.settingsVersion);
    if (h.settings.mode == Mode::AutoSignal) {
        body += "\"mode\":\"auto_signal\",";
        if (h.settings.pauseMinMs == h.settings.pauseMaxMs) {
            appendf(body, "\"pause\":{\"mode\":\"fixed\",\"fixedMs\":%" PRIu32 "},",
                    h.settings.pauseMinMs);
        } else {
            appendf(body, "\"pause\":{\"mode\":\"random\",\"minMs\":%" PRIu32 ",", h.settings.pauseMinMs);
            appendf(body, "\"maxMs\":%" PRIu32 "},", h.settings.pauseMaxMs);
        }
    } else {
        body += "\"mode\":\"count_only\",\"pause\":null,";
    }
    body += "\"startedAt\":\"" + formatIso8601Utc(startedEpochMs) + "\",";
    body += "\"endedAt\":\"" + formatIso8601Utc(endedEpochMs) + "\",";
    body += "\"reps\":";
    body += repsJson;
    body += '}';
    return body;
}

TimeResolution resolveStartTime(const StoredSetHeader& h, uint32_t currentBootId, bool timeSynced,
                                int64_t nowEpochMs, uint64_t nowUptimeMs) {
    if (h.startedEpochMs > 0) return {TimeStatus::Ready, h.startedEpochMs};
    if (h.bootId != currentBootId) return {TimeStatus::Unrecoverable, 0};
    if (!timeSynced || nowUptimeMs < h.startedUptimeMs) return {TimeStatus::WaitForNtp, 0};
    return {TimeStatus::Ready,
            nowEpochMs - static_cast<int64_t>(nowUptimeMs - h.startedUptimeMs)};
}

}  // namespace presscall

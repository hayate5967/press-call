#include "recording_codec.h"

#include <cmath>
#include <cstdio>

#include "json_reader.h"

namespace presscall {

namespace {

using json::Reader;

bool digits(const std::string& s, size_t pos, size_t n, int& out) {
    if (pos + n > s.size()) return false;
    int v = 0;
    for (size_t i = pos; i < pos + n; ++i) {
        if (s[i] < '0' || s[i] > '9') return false;
        v = v * 10 + (s[i] - '0');
    }
    out = v;
    return true;
}

// 1970-01-01 からの日数（グレゴリオ暦。Howard Hinnant の days_from_civil）
int64_t daysFromCivil(int y, int m, int d) {
    y -= m <= 2 ? 1 : 0;
    const int era = (y >= 0 ? y : y - 399) / 400;
    const int yoe = y - era * 400;
    const int doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const int doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return static_cast<int64_t>(era) * 146097 + doe - 719468;
}

// 時刻（文字列か null）。null なら -1
bool parseTimeOrNull(Reader& r, int64_t& out) {
    if (r.literal("null")) {
        out = -1;
        return true;
    }
    std::string s;
    return r.string(s) && parseIsoUtcMs(s, out);
}

}  // namespace

bool parseIsoUtcMs(const std::string& iso, int64_t& outMs) {
    // YYYY-MM-DDTHH:MM:SS(.mmm)Z
    int y, mo, d, h, mi, sec, ms = 0;
    if (iso.size() < 20) return false;
    if (!digits(iso, 0, 4, y) || iso[4] != '-' || !digits(iso, 5, 2, mo) || iso[7] != '-' ||
        !digits(iso, 8, 2, d) || iso[10] != 'T' || !digits(iso, 11, 2, h) || iso[13] != ':' ||
        !digits(iso, 14, 2, mi) || iso[16] != ':' || !digits(iso, 17, 2, sec)) {
        return false;
    }
    size_t pos = 19;
    if (iso[pos] == '.') {
        // 小数部は 3 桁までをミリ秒として読み、それより細かい桁は捨てる
        ++pos;
        int scale = 100;
        size_t n = 0;
        while (pos < iso.size() && iso[pos] >= '0' && iso[pos] <= '9') {
            if (n < 3) ms += (iso[pos] - '0') * scale;
            scale /= 10;
            ++pos;
            ++n;
        }
        if (n == 0) return false;
    }
    if (pos + 1 != iso.size() || iso[pos] != 'Z') return false;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) return false;
    const int64_t days = daysFromCivil(y, mo, d);
    outMs = ((days * 24 + h) * 60 + mi) * 60000LL + sec * 1000LL + ms;
    return true;
}

bool parseRecordingJson(const std::string& json, RecordingCommand& out) {
    Reader r(json);
    if (!r.consume('{')) return false;
    RecordingCommand c;
    bool hasRecording = false, hasSeq = false, hasServerTime = false;
    if (!r.consume('}')) {
        do {
            std::string key;
            if (!r.string(key) || !r.consume(':')) return false;
            if (key == "recording") {
                if (r.literal("true")) {
                    c.recording = true;
                } else if (r.literal("false")) {
                    c.recording = false;
                } else {
                    return false;
                }
                hasRecording = true;
            } else if (key == "seq") {
                double v;
                if (!r.number(v) || v < 0 || v > 2147483647.0 || std::floor(v) != v) return false;
                c.seq = static_cast<uint32_t>(v);
                hasSeq = true;
            } else if (key == "startedAt") {
                if (!parseTimeOrNull(r, c.startedAtMs)) return false;
            } else if (key == "stoppedAt") {
                if (!parseTimeOrNull(r, c.stoppedAtMs)) return false;
            } else if (key == "serverTime") {
                std::string s;
                if (!r.string(s) || !parseIsoUtcMs(s, c.serverTimeMs)) return false;
                hasServerTime = true;
            } else if (!r.skipValue()) {
                return false;
            }
        } while (r.consume(','));
        if (!r.consume('}')) return false;
    }
    if (!r.atEnd() || !hasRecording || !hasSeq || !hasServerTime) return false;
    out = c;
    return true;
}

uint64_t serverTimeToUptime(int64_t eventMs, int64_t serverTimeMs, uint64_t responseUptimeMs) {
    const int64_t ago = serverTimeMs - eventMs;  // その出来事は応答のどれだけ前か
    if (ago <= 0) return responseUptimeMs;       // 未来の時刻（時計のずれ）は「今」にする
    return static_cast<uint64_t>(ago) >= responseUptimeMs ? 0 : responseUptimeMs - ago;
}

std::string buildStopRecordingBody(uint32_t seq) {
    char buf[48];
    std::snprintf(buf, sizeof(buf), "{\"recording\":false,\"seq\":%lu}",
                  static_cast<unsigned long>(seq));
    return buf;
}

}  // namespace presscall

// セットの記録を「LittleFS に保存する形」と「API に送る JSON」に変換する（API 仕様書 5 章 POST /device/sets）
//
// 保存ファイルは 2 行：
//   1 行目：ヘッダー（clientSetId・時刻・設定など。空白区切り）
//   2 行目：reps の JSON 配列（送るときにそのまま本文に埋め込む）
// 時刻を JSON にせず uptime のまま持つのは、NTP で時刻を合わせる前の記録を、
// 送る直前に実時刻へ直すため（FR-S08）。
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "set_recorder.h"

namespace presscall {

/** API が受け付けるリクエスト全体の上限は 64KB。reps の JSON はこれに収める */
constexpr size_t kRepsJsonBudget = 60 * 1024;

/** 保存ファイルの 1 行目に入れる情報 */
struct StoredSetHeader {
    std::string clientSetId;       // 冪等キー（UUID v4）
    uint32_t bootId = 0;           // 記録したときの起動回数。uptime はこの起動の中でだけ意味を持つ
    uint64_t startedUptimeMs = 0;
    uint64_t endedUptimeMs = 0;
    int64_t startedEpochMs = 0;    // 実時刻（UNIX 時刻のミリ秒）。NTP 前に記録したなら 0（不明）
    SetSettings settings{};
};

/** 16 バイトの乱数から UUID v4 の文字列を作る（版と変種のビットはここで立てる） */
std::string formatUuidV4(const uint8_t random[16]);

/** UNIX 時刻（ミリ秒）を ISO 8601 の UTC 文字列にする。例：2026-11-15T09:30:12.400Z */
std::string formatIso8601Utc(int64_t epochMs);

/** reps の JSON 配列を作る。速度カーブで budget を超えそうなレップは、カーブを null にする */
std::string encodeRepsJson(const SetRecord& set, size_t budget = kRepsJsonBudget);

/** 保存ファイルの 1 行目（改行なし） */
std::string encodeHeader(const StoredSetHeader& h);

/** 1 行目を読む。形が違えば false */
bool decodeHeader(const std::string& line, StoredSetHeader& out);

/** API に送る本文を作る。startedEpochMs は送る直前に確定した実時刻 */
std::string buildSetBody(const StoredSetHeader& h, int64_t startedEpochMs,
                         const std::string& repsJson);

// ===== 時刻の補正（FR-S08） =====

enum class TimeStatus : uint8_t {
    Ready,           // 実時刻が決まった
    WaitForNtp,      // この起動中の記録だが、まだ NTP で時刻を合わせていない
    Unrecoverable,   // NTP 前に記録して再起動をまたいだ。uptime がリセットされて直せない
};

struct TimeResolution {
    TimeStatus status = TimeStatus::WaitForNtp;
    int64_t startedEpochMs = 0;
};

/**
 * 記録の開始時刻を実時刻にする。
 * 記録時に実時刻が分かっていればそれを使う。分からなければ、同じ起動中で NTP 同期済みのときだけ
 * 「現在時刻 −（現在の uptime − 記録時の uptime）」で直す
 */
TimeResolution resolveStartTime(const StoredSetHeader& h, uint32_t currentBootId, bool timeSynced,
                                int64_t nowEpochMs, uint64_t nowUptimeMs);

}  // namespace presscall

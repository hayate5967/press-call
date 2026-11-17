// 時刻のヘルパー（StorageTask と NetTask で共通に使う）
//   uptime：起動からの経過時間（ミリ秒）。再起動で 0 に戻る
//   実時刻：NTP で合わせた UNIX 時刻（ミリ秒）。合わせる前は使えない
#pragma once

#include <esp_timer.h>
#include <sys/time.h>

#include <cstdint>
#include <ctime>

namespace presscall::clock {

/** これより後なら NTP で時刻が合っている（2023 年） */
constexpr time_t kValidEpochSec = 1700000000;

inline uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time() / 1000); }

inline bool timeSynced() { return time(nullptr) > kValidEpochSec; }

inline int64_t nowEpochMs() {
    timeval tv{};
    gettimeofday(&tv, nullptr);
    return static_cast<int64_t>(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

}  // namespace presscall::clock

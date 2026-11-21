// セットの開始・終了の指示（GET・PUT /device/recording、ADR-0011）の読み書き
// Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>
#include <string>

namespace presscall {

/** サーバから届いた指示。時刻は UNIX 時刻のミリ秒（なければ -1） */
struct RecordingCommand {
    bool recording = false;
    uint32_t seq = 0;
    int64_t startedAtMs = -1;  // 最後に開始を押した時刻
    int64_t stoppedAtMs = -1;  // 最後に終了した時刻
    int64_t serverTimeMs = -1; // 応答を作ったときのサーバの時刻
};

/** GET・PUT /device/recording の応答を読む。形が違えば false */
bool parseRecordingJson(const std::string& json, RecordingCommand& out);

/** "2026-11-21T10:00:03.120Z" の形（UTC）を UNIX 時刻のミリ秒にする。形が違えば false */
bool parseIsoUtcMs(const std::string& iso, int64_t& outMs);

/**
 * サーバの時刻 eventMs（押した時刻など）を、この機器の uptime に直す。
 * 応答を受け取ったときの uptime と、応答に入っていたサーバの時刻の差を使う（NTP が合っていなくてもよい）。
 * 通信にかかった時間ぶん（ふつう 1 秒未満）少し早めにずれる。0 より前になるなら 0
 */
uint64_t serverTimeToUptime(int64_t eventMs, int64_t serverTimeMs, uint64_t responseUptimeMs);

/** PUT /device/recording の本文（自分で終えたことを知らせる） */
std::string buildStopRecordingBody(uint32_t seq);

}  // namespace presscall

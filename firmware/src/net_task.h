// NetTask：コア 0 で動く通信担当（アーキテクチャ設計 2 章）
//
// テザリングへの接続、NTP、ペアリング（デバイストークンを NVS に保存）、http://bench.local のページ、
// 再送キュー（LittleFS）の送信・再送、設定の取得を受け持つ。
// セットの保存は StorageTask が行い、NetTask は LittleFS から読んで送るだけ。
// 計測（コア 1）とは FreeRTOS のキューでだけやり取りし、計測側は通信を待たない。
//   計測 → NetTask：セット中かどうか（setInSet）、ボタンで始めたセットを自分で終えた（notifyAutoStopped）
//   NetTask → 計測：新しい設定（takeNewSettings）、セットの開始・終了の指示（takeRecordingInstruction）、
//                   サーバにつながっているか（manualAvailable）
#pragma once

#include <cstdint>

#include "settings_codec.h"

namespace presscall::net {

/**
 * NetTask を作る。setup() で 1 回だけ、store::begin() の後に呼ぶ。
 * current は今使っている設定（その version で「変わったか」を問い合わせる）
 */
bool start(const DeviceSettings& current);

/** セット中かどうかを NetTask に知らせる（セット中は設定を問い合わせない） */
void setInSet(bool inSet);

/**
 * 今の持ち主（デバイストークンの指紋）。ペアリング中は 0。
 * StorageTask が記録に付け、ペアリングし直した後に前の持ち主の記録を送らないために使う
 */
uint32_t ownerFingerprint();

/**
 * セットの開始・終了の指示（ADR-0011）。時刻はこの機器の uptime に直してある。
 * 5 秒おきに届く。seq が前回と同じなら同じ指示（計測側で見分ける）
 */
struct RecordingInstruction {
    uint32_t seq = 0;
    bool recording = false;
    uint64_t startUptimeMs = 0;  // 最後に開始を押した時刻（押されたことがなければ 0）
    bool hasStop = false;
    uint64_t stopUptimeMs = 0;   // 最後に終了した時刻
};

/** 新しい指示が届いていれば out に入れて true（計測側から呼ぶ。待たない） */
bool takeRecordingInstruction(RecordingInstruction& out);

/**
 * ボタンで区切れるか（指示の問い合わせが最近 15 秒以内に成功しているか）。
 * false のあいだ、計測側は動きでセットを区切る
 */
bool manualAvailable();

/** ボタンで始めたセットを、動きがないので自分で終えた（NetTask がサーバに伝える） */
void notifyAutoStopped(uint32_t seq);

/** 新しい設定が届いていれば out に入れて true（計測側から呼ぶ。待たない） */
bool takeNewSettings(DeviceSettings& out);

/**
 * NVS に保存したデバイストークンの指紋（保存した設定がこのトークンのものか確かめる）。
 * まだペアリングしていなければ 0
 */
uint32_t deviceTokenFingerprint();

}  // namespace presscall::net

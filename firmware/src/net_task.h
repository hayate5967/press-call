// NetTask：コア 0 で動く通信担当（アーキテクチャ設計 2 章）
//
// テザリングへの接続、NTP、再送キュー（LittleFS）の送信・再送、設定の取得を受け持つ。
// セットの保存は StorageTask が行い、NetTask は LittleFS から読んで送るだけ。
// 計測（コア 1）とは FreeRTOS のキューでだけやり取りし、計測側は通信を待たない。
//   計測 → NetTask：セット中かどうか（setInSet）
//   NetTask → 計測：新しい設定（takeNewSettings）
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

/** 新しい設定が届いていれば out に入れて true（計測側から呼ぶ。待たない） */
bool takeNewSettings(DeviceSettings& out);

/** secrets.h のデバイストークンの指紋（保存した設定がこのトークンのものか確かめる） */
uint32_t deviceTokenFingerprint();

}  // namespace presscall::net

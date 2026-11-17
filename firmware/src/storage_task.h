// StorageTask：終わったセットをすぐ LittleFS に保存する（FR-D11「送る前に必ず保存」）
//
// 計測（コア 1）→ キュー → StorageTask（コア 0）→ LittleFS → NetTask が読んで送信・再送
//
// NetTask は HTTPS の通信で最長 25 秒ほど止まることがある。保存を NetTask と別のタスクにし、
// 優先度を NetTask より高くすることで、通信中でもセットがすぐフラッシュに残るようにしている。
// 計測側はキューに入れるだけで、フラッシュには書かない。
#pragma once

#include <memory>

#include "set_recorder.h"

namespace presscall::storage {

/** キューと StorageTask を作る。setup() で 1 回だけ、store::begin() の後に呼ぶ */
bool start();

/**
 * 終わったセットを StorageTask に渡す（計測側から呼ぶ。待たずにすぐ戻る）。
 * キューがいっぱいなら false（そのセットは失われる）
 */
bool submit(std::unique_ptr<SetRecord> set);

}  // namespace presscall::storage

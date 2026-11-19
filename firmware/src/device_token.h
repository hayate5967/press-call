// デバイストークンの保存場所（NVS）。ペアリングで受け取ったトークンを再起動しても使えるようにする
//
// NVS はフラッシュの「キーと値」の保存場所。LittleFS（セットの記録）とは別の領域なので、
// 記録を消さずにトークンだけを入れ替えられる。
// NetTask（と、タスクを作る前の setup()）からだけ呼ぶ。
// 注意：NVS は暗号化していないので、ESP32 を持ち出されるとトークンを読まれうる。
// そのときは Web アプリでデバイスを失効させる（ADR-0006：不透明トークンなのですぐ失効できる）
#pragma once

#include <string>

namespace presscall::token {

/** 保存したトークン。なければ（またはおかしな値なら）空 */
std::string load();

/** トークンを保存する。失敗したら false */
bool save(const std::string& token);

/** トークンを消す（401 を受けて、ペアリングし直すとき） */
void clear();

}  // namespace presscall::token

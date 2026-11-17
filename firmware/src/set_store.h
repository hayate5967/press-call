// LittleFS の再送キュー（FR-D11・FR-S05・FR-S06）
//
// 1 セット = 1 ファイル（/q/0000000001.set のような連番）。番号が小さいほど古い。
// 書き込みは一時ファイルに書いてから名前を変えるので、途中で電源が切れても壊れたファイルは残らない。
// begin() は setup() で（タスクを作る前に）1 回だけ呼ぶ。
// それ以降は StorageTask（保存）と NetTask（読み出し・削除・設定）が使う。どの関数もミューテックスで排他する。
// 計測タスク（コア 1）からは呼ばない（フラッシュの書き込みを待たせないため）。
#pragma once

#include <Arduino.h>

#include <string>

#include "set_codec.h"
#include "settings_codec.h"

namespace presscall::store {

/** LittleFS をマウントし、起動回数を 1 つ進める。失敗したら false */
bool begin();

/** 今回の起動の番号（再起動をまたいだ記録を見分けるのに使う） */
uint32_t bootId();

/** セットを保存する */
bool save(const StoredSetHeader& header, const std::string& repsJson);

/** いちばん古いファイルのパス。なければ false */
bool oldest(String& path);

/** ファイルを読む。形が壊れていれば false */
bool load(const String& path, StoredSetHeader& header, std::string& repsJson);

void remove(const String& path);

/** 保存されている（未送信の）セットの数。メモリに持っている値を返すだけなので軽い */
size_t count();

/**
 * 最後に API から取った設定を読む（FR-D10：つながらなくても前回の設定で動く）。
 * なければ、または別のトークン（fingerprint が違う）で取った設定なら false
 */
bool loadSettings(uint32_t fingerprint, DeviceSettings& out);

/** 取った設定を、取ったときのトークンの指紋と一緒に保存する */
bool saveSettings(const DeviceSettings& s, uint32_t fingerprint);

}  // namespace presscall::store

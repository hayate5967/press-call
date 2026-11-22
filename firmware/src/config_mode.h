// 設定モード（FR-C01・C02・C04）：ESP32 が自分の Wi-Fi（AP）と設定ページを出す
//
// iPhone でこの AP につなぎ、http://192.168.4.1 を開いて、テザリングの SSID とパスワードを登録する。
// AP は WPA2 のパスワードで守る（パスワードは secrets.h の CONFIG_AP_PASSWORD）。
// 設定モードのあいだは計測も通信もしない（セットの記録は LittleFS に残る）。
// 保存したら再起動して通常の動きに戻る。10 分何もなければ、BOOT ボタンをもう一度長押ししても戻る
#pragma once

#include <cstdint>

namespace presscall::configmode {

/** AP のパスワードが使える形か（secrets.h を作ってあり、8〜63 文字） */
bool apPasswordUsable();

/**
 * 設定モードを始める。始められれば、再起動するまで戻らない。
 * 始められないとき（AP のパスワードがない・AP を作れない）は理由をログに出して false を返す。
 * setLed は LED を点ける・消す（設定モード中は速く点滅させる。LED は GPIO2 に付けたときだけ光る）
 */
bool run(void (*setLed)(bool on));

}  // namespace presscall::configmode

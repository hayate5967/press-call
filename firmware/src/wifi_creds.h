// テザリングの SSID・パスワードの保管（NVS）と、設定モードに入る合図（FR-C01・C02）
//
// 設定モードで登録した値を使う。まだ登録がなければ、secrets.h の値を予備として使う
// （今までのデバイスが、書き込み直しても今までどおりつながるように）。
// secrets.h の TETHERING_SSID を "" にしておくと、「初回は設定モードから始める」動きになる
#pragma once

#include "wifi_form.h"

namespace presscall::wifi {

/** NVS に保存した値があれば out に入れて true */
bool loadSaved(WifiCredentials& out);

/** 今使う値：NVS に保存した値、なければ secrets.h の値。どちらもなければ false（SSID が空） */
bool loadEffective(WifiCredentials& out);

/** NVS に保存する（設定ページから）。保存できたら true */
bool save(const WifiCredentials& c);

/** 設定モードに入ってほしい、という印（ボタンの長押しで付ける）。再起動後に 1 回だけ読む */
void requestConfigMode();

/** 印があれば消して true を返す。電源を入れ直しても設定モードに入り続けないよう、読んだらすぐ消す */
bool takeConfigModeRequest();

/** 初回起動か（保存した値がなく、secrets.h の SSID も空）。設定モードから始める */
bool needsFirstSetup();

}  // namespace presscall::wifi

// secrets.h を読み込む。まだ作っていない（clone 直後や CI）ときは、ビルドだけ通るように
// secrets.example.h の仮の値を使い、警告を出す。仮の値ではテザリングにも API にもつながらない
#pragma once

#if __has_include("secrets.h")
#include "secrets.h"
#define PRESSCALL_SECRETS_ARE_PLACEHOLDERS 0
#else
#warning "include/secrets.h がありません。secrets.example.h の仮の値でビルドします"
#include "secrets.example.h"
#define PRESSCALL_SECRETS_ARE_PLACEHOLDERS 1
#endif

#if !defined(TETHERING_SSID) || !defined(TETHERING_PASSWORD) || !defined(API_BASE_URL)
#error "secrets.h に TETHERING_SSID・TETHERING_PASSWORD・API_BASE_URL を書いてください（secrets.example.h を参照）"
#endif

// デバイストークンはペアリングで受け取って NVS に保存するようになった（ステップ 5-2）。
// 古い secrets.h に残っていても使わない
#if defined(DEVICE_TOKEN)
#warning "secrets.h の DEVICE_TOKEN は使われません（ペアリングで受け取ります）。消してかまいません"
#endif

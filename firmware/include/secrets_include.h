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

#if !defined(TETHERING_SSID) || !defined(TETHERING_PASSWORD) || !defined(API_BASE_URL) || \
    !defined(DEVICE_TOKEN)
#error "secrets.h に TETHERING_SSID・TETHERING_PASSWORD・API_BASE_URL・DEVICE_TOKEN を書いてください（secrets.example.h を参照）"
#endif

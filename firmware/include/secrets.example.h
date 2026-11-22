// このファイルを secrets.h にコピーして値を入れる（secrets.h は Git に入れない）
#pragma once

// iPhone のテザリング（2.4GHz。iPhone 12 以降は「互換性を優先」をオン）。
// 設定モード（BOOT ボタンを 3 秒長押し）で登録した値が優先され、ここの値は予備として使われる。
// TETHERING_SSID を "" にしておくと、初回起動は設定モードから始まる
#define TETHERING_SSID "your-iphone-hotspot"
#define TETHERING_PASSWORD "your-password"

// 設定モードで ESP32 が出す Wi-Fi（AP）のパスワード（8〜63 文字）。自分だけが知る値にする。
// 書かないと設定モードは使えない
#define CONFIG_AP_PASSWORD "your-config-ap-password"

// API のベース URL（末尾の / は付けない）。セットは API_BASE_URL + "/device/sets" に送る
#define API_BASE_URL "https://press-call.<your-subdomain>.workers.dev/api/v1"

// デバイストークンはここには書かない。初回起動時にペアリングして受け取り、NVS に保存する
// （http://bench.local に出るコードを Web アプリで許可する。API 仕様書 4 章）

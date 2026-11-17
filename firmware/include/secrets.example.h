// このファイルを secrets.h にコピーして値を入れる（secrets.h は Git に入れない）
// 設定モード（FR-C01〜C04）ができるまでの、開発初期の一時的な置き場
#pragma once

// iPhone のテザリング（2.4GHz。iPhone 12 以降は「互換性を優先」をオン）
#define TETHERING_SSID "your-iphone-hotspot"
#define TETHERING_PASSWORD "your-password"

// API のベース URL（末尾の / は付けない）。セットは API_BASE_URL + "/device/sets" に送る
#define API_BASE_URL "https://press-call.<your-subdomain>.workers.dev/api/v1"

// デバイストークンはここには書かない。初回起動時にペアリングして受け取り、NVS に保存する
// （http://bench.local に出るコードを Web アプリで許可する。API 仕様書 4 章）

// http://bench.local のページ（ADR-0006 の手順 3）
//
// テザリングの中で、iPhone から mDNS の名前 bench.local で開ける小さな Web サーバ。
// ペアリング中はコードと「Web アプリで許可する」リンクを、ペアリング後は状態を表示する。
// NetTask から呼ぶ（handle() を短い間隔で呼び続ける）
#pragma once

#include "pairing_codec.h"

namespace presscall::bench {

/** mDNS と Web サーバを始める。テザリングにつながってから 1 回だけ呼ぶ（2 回目以降は何もしない） */
void begin();

/** 表示する内容を差し替える */
void update(const PairingPage& page);

/** 届いたリクエストに応える（NetTask のループで呼ぶ） */
void handle();

}  // namespace presscall::bench

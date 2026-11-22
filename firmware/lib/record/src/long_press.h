// ボタンの長押しの判定（設定モードへの入り口、FR-C01）。Arduino に依存しないので、PC 上でテストできる。
#pragma once

#include <cstdint>

namespace presscall {

/**
 * 押している間ずっと update() を呼ぶ。押し続けて holdMs たったとき 1 回だけ true を返す。
 * 離すと数え直す。押したままでも 2 回目は返さない（離してから押し直すと、また数える）
 */
class LongPress {
public:
    explicit LongPress(uint32_t holdMs = 3000) : holdMs_(holdMs) {}

    bool update(uint32_t nowMs, bool pressed) {
        if (!pressed) {
            holding_ = false;
            fired_ = false;
            return false;
        }
        if (!holding_) {
            holding_ = true;
            pressedAtMs_ = nowMs;
            return false;
        }
        if (!fired_ && static_cast<uint32_t>(nowMs - pressedAtMs_) >= holdMs_) {
            fired_ = true;
            return true;
        }
        return false;
    }

private:
    uint32_t holdMs_;
    bool holding_ = false;
    bool fired_ = false;
    uint32_t pressedAtMs_ = 0;
};

}  // namespace presscall

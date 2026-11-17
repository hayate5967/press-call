#include "storage_task.h"

#include <Arduino.h>
#include <esp_random.h>

#include "device_clock.h"
#include "set_codec.h"
#include "set_store.h"

namespace presscall::storage {

namespace {

constexpr uint32_t kQueueLength = 4;          // 保存は数十 ms で終わるので、少しあれば足りる
constexpr uint32_t kStackBytes = 8 * 1024;    // reps の JSON（最大 60KB）はヒープに作るのでスタックは小さくてよい
constexpr UBaseType_t kPriority = 2;          // NetTask（1）より高く、通信中でも保存を先に進める
constexpr BaseType_t kCore = 0;               // 計測のコア 1 を使わない

QueueHandle_t gQueue = nullptr;  // 計測 → StorageTask：終わったセット（SetRecord* の持ち主ごと渡す）

void persist(const SetRecord& set) {
    StoredSetHeader h;
    uint8_t rnd[16];
    esp_fill_random(rnd, sizeof(rnd));  // Wi-Fi が動いていればハードウェアの真の乱数
    h.clientSetId = formatUuidV4(rnd);  // 冪等キー。保存した時点で決まり、再送しても変わらない
    h.bootId = store::bootId();
    h.startedUptimeMs = set.startedUptimeMs;
    h.endedUptimeMs = set.endedUptimeMs;
    h.settings = set.settings;
    if (clock::timeSynced()) {
        // 今の実時刻から、経過時間ぶん戻す（FR-S08）
        h.startedEpochMs =
            clock::nowEpochMs() - static_cast<int64_t>(clock::uptimeMs() - set.startedUptimeMs);
    }

    const bool ok = store::save(h, encodeRepsJson(set));
    // セット終了と判定してから、フラッシュに残るまでの時間（実機で確かめる用）
    const unsigned long latencyMs =
        static_cast<unsigned long>(clock::uptimeMs() - set.finishedUptimeMs);
    if (ok) {
        Serial.printf("# STORE saved set %s (%u reps) %lums after set end, pending=%u\n",
                      h.clientSetId.c_str(), static_cast<unsigned>(set.reps.size()), latencyMs,
                      static_cast<unsigned>(store::count()));
    } else {
        Serial.printf("# STORE ERROR: failed to save set to LittleFS (full?) %lums after set end\n",
                      latencyMs);
    }
}

void storageTask(void*) {
    for (;;) {
        SetRecord* received = nullptr;
        if (xQueueReceive(gQueue, &received, portMAX_DELAY) != pdTRUE) continue;
        std::unique_ptr<SetRecord> set(received);
        persist(*set);
    }
}

}  // namespace

bool start() {
    gQueue = xQueueCreate(kQueueLength, sizeof(SetRecord*));
    if (!gQueue) return false;
    return xTaskCreatePinnedToCore(storageTask, "StorageTask", kStackBytes, nullptr, kPriority,
                                   nullptr, kCore) == pdPASS;
}

bool submit(std::unique_ptr<SetRecord> set) {
    if (!gQueue) return false;
    SetRecord* raw = set.get();
    // 待たない（計測を止めない）。入れられたら持ち主は StorageTask に移る
    if (xQueueSend(gQueue, &raw, 0) != pdTRUE) return false;
    set.release();
    return true;
}

}  // namespace presscall::storage

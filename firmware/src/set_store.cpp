#include "set_store.h"

#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace presscall::store {

namespace {

constexpr const char* kDir = "/q";
constexpr const char* kTmpPath = "/q/tmp";
constexpr const char* kBootPath = "/boot";
constexpr const char* kSettingsPath = "/settings";
constexpr const char* kSettingsTmpPath = "/settings.tmp";

// LittleFS を使う関数はすべてこのミューテックスの中で動かす（StorageTask と NetTask が同時に触るため）。
// 下の変数（番号・未送信の数）もこのミューテックスで守る
SemaphoreHandle_t gMutex = nullptr;

uint32_t gBootId = 0;
uint32_t gNextSeq = 1;
size_t gPending = 0;  // 未送信のセットの数。毎回フォルダを読まずに済むよう、メモリに持つ

/** ミューテックスを関数の終わりまで持つ（return のたびに返し忘れないように） */
class Lock {
public:
    Lock() { xSemaphoreTake(gMutex, portMAX_DELAY); }
    ~Lock() { xSemaphoreGive(gMutex); }
    Lock(const Lock&) = delete;
    Lock& operator=(const Lock&) = delete;
};

bool isSetFile(const char* name) {
    const size_t len = strlen(name);
    return len == 14 && strcmp(name + 10, ".set") == 0;  // 10 桁の番号 + ".set"
}

uint32_t readBootCount() {
    File f = LittleFS.open(kBootPath, "r");
    if (!f) return 0;
    const uint32_t n = static_cast<uint32_t>(f.readString().toInt());
    f.close();
    return n;
}

}  // namespace

bool begin() {
    if (!gMutex) gMutex = xSemaphoreCreateMutex();
    if (!gMutex) return false;
    Lock lock;

    if (!LittleFS.begin(true)) return false;  // 初回はフォーマットする
    if (!LittleFS.exists(kDir) && !LittleFS.mkdir(kDir)) return false;
    // 前回、書き込み途中で切れたもの
    if (LittleFS.exists(kTmpPath)) LittleFS.remove(kTmpPath);
    if (LittleFS.exists(kSettingsTmpPath)) LittleFS.remove(kSettingsTmpPath);

    gBootId = readBootCount() + 1;
    File f = LittleFS.open(kBootPath, "w");
    if (f) {
        f.print(gBootId);
        f.close();
    }

    // 続きの番号と、未送信の数を数える
    gPending = 0;
    File dir = LittleFS.open(kDir);
    for (File e = dir.openNextFile(); e; e = dir.openNextFile()) {
        if (isSetFile(e.name())) {
            ++gPending;
            const uint32_t seq = static_cast<uint32_t>(strtoul(e.name(), nullptr, 10));
            if (seq >= gNextSeq) gNextSeq = seq + 1;
        }
        e.close();
    }
    return true;
}

uint32_t bootId() { return gBootId; }  // begin() の後は変わらないのでロックしない

bool save(const StoredSetHeader& header, const std::string& repsJson) {
    Lock lock;
    File f = LittleFS.open(kTmpPath, "w");
    if (!f) return false;
    const std::string line = encodeHeader(header);
    bool ok = f.write(reinterpret_cast<const uint8_t*>(line.data()), line.size()) == line.size();
    ok = ok && f.write('\n') == 1;
    ok = ok && f.write(reinterpret_cast<const uint8_t*>(repsJson.data()), repsJson.size()) ==
                   repsJson.size();
    ok = ok && f.write('\n') == 1;
    f.close();
    if (!ok) {
        LittleFS.remove(kTmpPath);  // 容量不足など
        return false;
    }
    char path[32];
    snprintf(path, sizeof(path), "%s/%010lu.set", kDir, static_cast<unsigned long>(gNextSeq));
    if (!LittleFS.rename(kTmpPath, path)) {
        LittleFS.remove(kTmpPath);
        return false;
    }
    ++gNextSeq;
    ++gPending;
    return true;
}

bool oldest(String& path) {
    Lock lock;
    if (gPending == 0) return false;  // 送るものがなければフォルダを読まない
    File dir = LittleFS.open(kDir);
    String best;
    for (File e = dir.openNextFile(); e; e = dir.openNextFile()) {
        const String name = e.name();
        e.close();
        if (!isSetFile(name.c_str())) continue;
        if (best.isEmpty() || name < best) best = name;  // 0 埋めの番号なので文字列の比較で古い順になる
    }
    if (best.isEmpty()) {
        gPending = 0;  // 数がずれていた（外から消されたなど）。実際に合わせる
        return false;
    }
    path = String(kDir) + "/" + best;
    return true;
}

bool load(const String& path, StoredSetHeader& header, std::string& repsJson) {
    Lock lock;
    File f = LittleFS.open(path, "r");
    if (!f) return false;
    std::string all;
    all.resize(f.size());
    const size_t n = f.read(reinterpret_cast<uint8_t*>(&all[0]), all.size());
    f.close();
    if (n != all.size()) return false;

    const size_t nl = all.find('\n');
    if (nl == std::string::npos || all.size() < nl + 4 || all.back() != '\n') return false;
    if (!decodeHeader(all.substr(0, nl), header)) return false;
    repsJson = all.substr(nl + 1, all.size() - nl - 2);
    return repsJson.front() == '[' && repsJson.back() == ']';
}

void remove(const String& path) {
    Lock lock;
    if (LittleFS.remove(path) && gPending > 0) --gPending;
}

size_t count() {
    Lock lock;
    return gPending;
}

bool loadSettings(uint32_t fingerprint, DeviceSettings& out) {
    Lock lock;
    File f = LittleFS.open(kSettingsPath, "r");
    if (!f) return false;
    const String line = f.readString();
    f.close();
    return decodeSettingsLine(line.c_str(), fingerprint, out);
}

bool saveSettings(const DeviceSettings& s, uint32_t fingerprint) {
    Lock lock;
    // セットと同じく、一時ファイルに書いてから名前を変える（途中で電源が切れても前の設定が残る）
    File f = LittleFS.open(kSettingsTmpPath, "w");
    if (!f) return false;
    const std::string line = encodeSettingsLine(s, fingerprint);
    const bool ok =
        f.write(reinterpret_cast<const uint8_t*>(line.data()), line.size()) == line.size();
    f.close();
    if (!ok || !LittleFS.rename(kSettingsTmpPath, kSettingsPath)) {
        LittleFS.remove(kSettingsTmpPath);
        return false;
    }
    return true;
}

}  // namespace presscall::store

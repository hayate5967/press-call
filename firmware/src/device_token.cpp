#include "device_token.h"

#include <Arduino.h>
#include <Preferences.h>

#include "pairing_codec.h"

namespace presscall::token {

namespace {
constexpr char kNamespace[] = "presscall";
constexpr char kKey[] = "devtoken";
}  // namespace

std::string load() {
    Preferences prefs;
    // 読み取り専用で開く。初回（まだ書いたことがない）は開けないが、それは「トークンなし」
    if (!prefs.begin(kNamespace, true)) return "";
    const String value = prefs.getString(kKey, "");
    prefs.end();
    std::string token = value.c_str();
    return isPlausibleDeviceToken(token) ? token : "";
}

bool save(const std::string& token) {
    if (!isPlausibleDeviceToken(token)) return false;
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return false;
    const size_t written = prefs.putString(kKey, token.c_str());
    prefs.end();
    return written == token.size();
}

void clear() {
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return;
    prefs.remove(kKey);
    prefs.end();
}

}  // namespace presscall::token

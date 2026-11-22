#include "wifi_creds.h"

#include <Arduino.h>
#include <Preferences.h>

#include "secrets_include.h"

namespace presscall::wifi {

namespace {
constexpr char kNamespace[] = "presscall";
constexpr char kSsidKey[] = "wifissid";
constexpr char kPasswordKey[] = "wifipass";
constexpr char kConfigKey[] = "cfgmode";
}  // namespace

bool loadSaved(WifiCredentials& out) {
    Preferences prefs;
    if (!prefs.begin(kNamespace, true)) return false;  // まだ何も書いていない
    const String ssid = prefs.getString(kSsidKey, "");
    const String password = prefs.getString(kPasswordKey, "");
    prefs.end();
    WifiCredentials c;
    // 保存するときに確かめているが、壊れた値で動かないよう、読むときにも同じ規則で確かめる
    if (validateWifiCredentials(ssid.c_str(), password.c_str(), c) != WifiFormError::None) {
        return false;
    }
    out = c;
    return true;
}

bool loadEffective(WifiCredentials& out) {
    if (loadSaved(out)) return true;
    if (std::string(TETHERING_SSID).empty()) return false;
    out.ssid = TETHERING_SSID;
    out.password = TETHERING_PASSWORD;
    return true;
}

bool save(const WifiCredentials& c) {
    WifiCredentials checked;
    if (validateWifiCredentials(c.ssid, c.password, checked) != WifiFormError::None) return false;
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return false;
    const size_t a = prefs.putString(kSsidKey, checked.ssid.c_str());
    const size_t b = prefs.putString(kPasswordKey, checked.password.c_str());
    prefs.end();
    return a == checked.ssid.size() && b == checked.password.size();
}

void requestConfigMode() {
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return;
    prefs.putBool(kConfigKey, true);
    prefs.end();
}

bool takeConfigModeRequest() {
    Preferences prefs;
    if (!prefs.begin(kNamespace, false)) return false;
    const bool requested = prefs.getBool(kConfigKey, false);
    if (requested) prefs.remove(kConfigKey);
    prefs.end();
    return requested;
}

bool needsFirstSetup() {
    WifiCredentials c;
    return !loadEffective(c);
}

}  // namespace presscall::wifi

#include "bench_page.h"

#include <Arduino.h>
#include <ESPmDNS.h>
#include <WebServer.h>

#include <string>

namespace presscall::bench {

namespace {

constexpr char kHostName[] = "bench";  // → http://bench.local

WebServer gServer(80);
bool gStarted = false;
std::string gHtml = renderPairingPage(PairingPage{});

void handleRoot() {
    // 状態が変わるページなので、古い内容をキャッシュさせない
    gServer.sendHeader("Cache-Control", "no-store");
    gServer.sendHeader("X-Content-Type-Options", "nosniff");
    gServer.send(200, "text/html; charset=utf-8", gHtml.c_str());
}

void handleOther() {
    // ページは 1 つだけ。ほかのパスはトップへ
    gServer.sendHeader("Location", "/");
    gServer.send(302, "text/plain", "");
}

}  // namespace

void begin() {
    if (gStarted) return;
    if (MDNS.begin(kHostName)) {
        MDNS.addService("http", "tcp", 80);
    } else {
        Serial.println("# NET WARNING: mDNS failed. bench.local will not resolve");
    }
    gServer.on("/", HTTP_GET, handleRoot);
    gServer.onNotFound(handleOther);
    gServer.begin();
    gStarted = true;
    Serial.println("# NET http://bench.local started");
}

void update(const PairingPage& page) { gHtml = renderPairingPage(page); }

void handle() {
    if (gStarted) gServer.handleClient();
}

}  // namespace presscall::bench

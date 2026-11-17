// ペアリングの応答の読み取りと bench.local のページのテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <string>

#include "pairing_codec.h"

using namespace presscall;

namespace {

const char* kAuthorize =
    R"({"deviceCode":"kHq3abc_DEF-123","userCode":"BCDF-GHJK",)"
    R"("verificationUri":"https://press-call.test/devices/pair",)"
    R"("verificationUriComplete":"https://press-call.test/devices/pair?code=BCDF-GHJK",)"
    R"("expiresIn":600,"interval":5})";

const std::string kToken = "dvt_" + std::string(43, 'A');

PollOutcome classify(int status, const std::string& body) {
    std::string token;
    return classifyTokenResponse(status, body, token);
}

bool contains(const std::string& s, const char* part) { return s.find(part) != std::string::npos; }

}  // namespace

void setUp() {}
void tearDown() {}

// ---- POST /device/authorize ----

void test_parse_authorize() {
    PairingCode c;
    TEST_ASSERT_TRUE(parseAuthorizeResponse(kAuthorize, c));
    TEST_ASSERT_EQUAL_STRING("kHq3abc_DEF-123", c.deviceCode.c_str());
    TEST_ASSERT_EQUAL_STRING("BCDF-GHJK", c.userCode.c_str());
    TEST_ASSERT_EQUAL_STRING("https://press-call.test/devices/pair?code=BCDF-GHJK",
                             c.verificationUriComplete.c_str());
    TEST_ASSERT_EQUAL_UINT32(600, c.expiresInSec);
    TEST_ASSERT_EQUAL_UINT32(5, c.intervalSec);
}

void test_parse_authorize_rejects_bad_values() {
    PairingCode c;
    // userCode に母音
    TEST_ASSERT_FALSE(parseAuthorizeResponse(
        R"({"deviceCode":"abc","userCode":"ABCD-EFGH","verificationUriComplete":"https://x/","expiresIn":600,"interval":5})",
        c));
    // リンクが http(s) でない（ページに出すので javascript: を通さない）
    TEST_ASSERT_FALSE(parseAuthorizeResponse(
        R"j({"deviceCode":"abc","userCode":"BCDF-GHJK","verificationUriComplete":"javascript:alert(1)","expiresIn":600,"interval":5})j",
        c));
    // deviceCode に base64url 以外（JSON に埋め込み直すので "" を通さない）
    TEST_ASSERT_FALSE(parseAuthorizeResponse(
        R"({"deviceCode":"a\"b","userCode":"BCDF-GHJK","verificationUriComplete":"https://x/","expiresIn":600,"interval":5})",
        c));
    // interval がない・0
    TEST_ASSERT_FALSE(parseAuthorizeResponse(
        R"({"deviceCode":"abc","userCode":"BCDF-GHJK","verificationUriComplete":"https://x/","expiresIn":600})",
        c));
    TEST_ASSERT_FALSE(parseAuthorizeResponse(
        R"({"deviceCode":"abc","userCode":"BCDF-GHJK","verificationUriComplete":"https://x/","expiresIn":600,"interval":0})",
        c));
    TEST_ASSERT_FALSE(parseAuthorizeResponse("not json", c));
    TEST_ASSERT_TRUE(c.deviceCode.empty());  // 失敗したら out は変えない
}

void test_token_request_body() {
    TEST_ASSERT_EQUAL_STRING(
        R"({"grantType":"urn:ietf:params:oauth:grant-type:device_code","deviceCode":"kHq3"})",
        buildTokenRequestBody("kHq3").c_str());
}

// ---- POST /device/token ----

void test_granted() {
    std::string token;
    const std::string body =
        R"({"accessToken":")" + kToken + R"(","tokenType":"Bearer","deviceId":"3f0a"})";
    TEST_ASSERT_EQUAL(PollOutcome::Granted, classifyTokenResponse(200, body, token));
    TEST_ASSERT_EQUAL_STRING(kToken.c_str(), token.c_str());
}

void test_granted_but_broken_token_restarts() {
    TEST_ASSERT_EQUAL(PollOutcome::Restart, classify(200, R"({"accessToken":"xyz"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Restart, classify(200, "oops"));
}

void test_rfc8628_errors() {
    TEST_ASSERT_EQUAL(PollOutcome::Pending, classify(400, R"({"error":"authorization_pending"})"));
    TEST_ASSERT_EQUAL(PollOutcome::SlowDown, classify(400, R"({"error":"slow_down"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Denied, classify(400, R"({"error":"access_denied"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Restart, classify(400, R"({"error":"expired_token"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Restart, classify(400, R"({"error":"invalid_grant"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Restart, classify(400, "broken"));
}

void test_server_errors_retry_with_same_code() {
    TEST_ASSERT_EQUAL(PollOutcome::Retry, classify(503, R"({"code":"db_unavailable"})"));
    TEST_ASSERT_EQUAL(PollOutcome::Retry, classify(500, ""));
    TEST_ASSERT_EQUAL(PollOutcome::Retry, classify(-1, ""));  // 通信失敗
}

void test_plausible_token() {
    TEST_ASSERT_TRUE(isPlausibleDeviceToken(kToken));
    TEST_ASSERT_FALSE(isPlausibleDeviceToken(""));
    TEST_ASSERT_FALSE(isPlausibleDeviceToken("rt_" + std::string(43, 'A')));
    TEST_ASSERT_FALSE(isPlausibleDeviceToken("dvt_short"));
    TEST_ASSERT_FALSE(isPlausibleDeviceToken("dvt_" + std::string(42, 'A') + "\n"));
}

// ---- bench.local のページ ----

void test_html_escape() {
    TEST_ASSERT_EQUAL_STRING("&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
                             htmlEscape("<a href=\"x\">&'").c_str());
}

void test_page_shows_code_and_link() {
    PairingPage p;
    p.phase = PairingPage::Phase::ShowCode;
    p.userCode = "BCDF-GHJK";
    p.verificationUriComplete = "https://press-call.test/devices/pair?code=BCDF-GHJK&x=1";
    p.remainingSec = 541;
    const std::string html = renderPairingPage(p);
    TEST_ASSERT_TRUE(contains(html, "BCDF-GHJK"));
    TEST_ASSERT_TRUE(contains(html, "href=\"https://press-call.test/devices/pair?code=BCDF-GHJK&amp;x=1\""));
    TEST_ASSERT_TRUE(contains(html, "残り 10 分"));
    TEST_ASSERT_TRUE(contains(html, "http-equiv=\"refresh\""));
}

void test_page_escapes_message() {
    PairingPage p;
    p.phase = PairingPage::Phase::Paired;
    p.message = "<script>alert(1)</script>";
    p.pendingSets = 3;
    const std::string html = renderPairingPage(p);
    TEST_ASSERT_FALSE(contains(html, "<script>"));
    TEST_ASSERT_TRUE(contains(html, "ペアリング済み"));
    TEST_ASSERT_TRUE(contains(html, "未送信のセット：3 件"));
}

void test_looks_same() {
    PairingPage a;
    a.phase = PairingPage::Phase::ShowCode;
    a.userCode = "BCDF-GHJK";
    a.remainingSec = 600;  // 残り 10 分（切り上げなので 541〜600 秒が 10 分）
    PairingPage b = a;
    b.remainingSec = 541;  // まだ 10 分 → 作り直さない
    TEST_ASSERT_TRUE(looksSame(a, b));
    b.remainingSec = 540;  // 9 分になった
    TEST_ASSERT_FALSE(looksSame(a, b));
    b = a;
    b.pendingSets = 1;
    TEST_ASSERT_FALSE(looksSame(a, b));

    // ペアリング済みのときは残り時間を見ない
    PairingPage p1, p2;
    p1.phase = p2.phase = PairingPage::Phase::Paired;
    p2.remainingSec = 100;
    TEST_ASSERT_TRUE(looksSame(p1, p2));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_parse_authorize);
    RUN_TEST(test_parse_authorize_rejects_bad_values);
    RUN_TEST(test_token_request_body);
    RUN_TEST(test_granted);
    RUN_TEST(test_granted_but_broken_token_restarts);
    RUN_TEST(test_rfc8628_errors);
    RUN_TEST(test_server_errors_retry_with_same_code);
    RUN_TEST(test_plausible_token);
    RUN_TEST(test_html_escape);
    RUN_TEST(test_page_shows_code_and_link);
    RUN_TEST(test_page_escapes_message);
    RUN_TEST(test_looks_same);
    return UNITY_END();
}

// 設定ページの入力の読み取りと HTML のテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <string>

#include "pairing_codec.h"  // htmlEscape
#include "wifi_form.h"

using namespace presscall;

void setUp() {}
void tearDown() {}

void test_url_decode() {
    std::string out;
    TEST_ASSERT_TRUE(urlDecode("a+b%20c%2Bd", out));
    TEST_ASSERT_EQUAL_STRING("a b c+d", out.c_str());
    TEST_ASSERT_TRUE(urlDecode("%E3%83%86%E3%82%B9%E3%83%88", out));  // UTF-8（テスト）
    TEST_ASSERT_EQUAL_STRING("\xE3\x83\x86\xE3\x82\xB9\xE3\x83\x88", out.c_str());
    TEST_ASSERT_TRUE(urlDecode("", out));
    TEST_ASSERT_EQUAL_STRING("", out.c_str());
}

void test_url_decode_rejects_broken_percent() {
    std::string out;
    TEST_ASSERT_FALSE(urlDecode("abc%", out));
    TEST_ASSERT_FALSE(urlDecode("abc%2", out));
    TEST_ASSERT_FALSE(urlDecode("abc%zz", out));
}

void test_parse_form_ok() {
    WifiCredentials c;
    TEST_ASSERT_EQUAL(WifiFormError::None,
                      parseWifiForm("ssid=My+iPhone&password=pass%26word1", c));
    TEST_ASSERT_EQUAL_STRING("My iPhone", c.ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("pass&word1", c.password.c_str());
}

void test_parse_form_trims_ssid_but_not_password() {
    WifiCredentials c;
    TEST_ASSERT_EQUAL(WifiFormError::None, parseWifiForm("ssid=++phone++&password=+++++++a+", c));
    TEST_ASSERT_EQUAL_STRING("phone", c.ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("       a ", c.password.c_str());  // 空白もパスワードの一部
}

void test_parse_form_field_order_and_extra() {
    WifiCredentials c;
    TEST_ASSERT_EQUAL(WifiFormError::None, parseWifiForm("x=1&password=12345678&ssid=net&y=2", c));
    TEST_ASSERT_EQUAL_STRING("net", c.ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("12345678", c.password.c_str());
}

void test_parse_form_errors() {
    WifiCredentials c;
    TEST_ASSERT_EQUAL(WifiFormError::SsidEmpty, parseWifiForm("ssid=&password=12345678", c));
    TEST_ASSERT_EQUAL(WifiFormError::SsidEmpty, parseWifiForm("ssid=+++&password=12345678", c));
    TEST_ASSERT_EQUAL(WifiFormError::SsidEmpty, parseWifiForm("password=12345678", c));
    TEST_ASSERT_EQUAL(WifiFormError::SsidTooLong,
                      parseWifiForm(("ssid=" + std::string(33, 'a') + "&password=12345678").c_str(), c));
    TEST_ASSERT_EQUAL(WifiFormError::PasswordLength, parseWifiForm("ssid=net&password=1234567", c));
    TEST_ASSERT_EQUAL(WifiFormError::PasswordLength, parseWifiForm("ssid=net", c));
    TEST_ASSERT_EQUAL(WifiFormError::PasswordLength,
                      parseWifiForm(("ssid=net&password=" + std::string(64, 'a')).c_str(), c));
    // 壊れた %XX は空として扱われ、結果として入力エラーになる
    TEST_ASSERT_EQUAL(WifiFormError::SsidEmpty, parseWifiForm("ssid=%zz&password=12345678", c));
}

void test_parse_form_boundaries() {
    WifiCredentials c;
    TEST_ASSERT_EQUAL(WifiFormError::None,
                      parseWifiForm(("ssid=" + std::string(32, 'a') + "&password=" + std::string(8, 'b')).c_str(), c));
    TEST_ASSERT_EQUAL(WifiFormError::None,
                      parseWifiForm(("ssid=n&password=" + std::string(63, 'b')).c_str(), c));
}

void test_password_length_counts_characters_not_bytes() {
    WifiCredentials c;
    // 日本語 7 文字（21 バイト）は 8 文字に足りない。8 文字（24 バイト）なら通る
    const std::string seven = "%E3%81%82%E3%81%82%E3%81%82%E3%81%82%E3%81%82%E3%81%82%E3%81%82";
    TEST_ASSERT_EQUAL(WifiFormError::PasswordLength, parseWifiForm("ssid=n&password=" + seven, c));
    TEST_ASSERT_EQUAL(WifiFormError::None,
                      parseWifiForm("ssid=n&password=" + seven + "%E3%81%82", c));
}

void test_validate_decoded_values_are_not_decoded_again() {
    WifiCredentials c;
    // WebServer がすでにデコードした値。「+」や「%」はそのままの文字として扱う
    TEST_ASSERT_EQUAL(WifiFormError::None, validateWifiCredentials(" a+b ", "p%41ss+word", c));
    TEST_ASSERT_EQUAL_STRING("a+b", c.ssid.c_str());
    TEST_ASSERT_EQUAL_STRING("p%41ss+word", c.password.c_str());
    TEST_ASSERT_EQUAL(WifiFormError::SsidEmpty, validateWifiCredentials("  ", "12345678", c));
}

void test_html_escape_and_page_is_safe() {
    TEST_ASSERT_EQUAL_STRING("&lt;script&gt;&amp;&quot;&#39;", htmlEscape("<script>&\"'").c_str());
    ConfigPage page;
    page.savedSsid = "<img src=x onerror=alert(1)>";
    page.message = "\"><b>x</b>";
    const std::string html = renderConfigPage(page);
    TEST_ASSERT_EQUAL(std::string::npos, html.find("<img src=x"));
    TEST_ASSERT_EQUAL(std::string::npos, html.find("\"><b>x</b>"));
    TEST_ASSERT_NOT_EQUAL(std::string::npos, html.find("&lt;img src=x"));
}

void test_page_never_contains_password_and_shows_form_or_saved() {
    ConfigPage page;
    page.savedSsid = "my-phone";
    std::string html = renderConfigPage(page);
    TEST_ASSERT_NOT_EQUAL(std::string::npos, html.find("action=\"/save\""));
    TEST_ASSERT_NOT_EQUAL(std::string::npos, html.find("今の登録：my-phone"));
    page.saved = true;
    html = renderConfigPage(page);
    TEST_ASSERT_EQUAL(std::string::npos, html.find("<form"));
    TEST_ASSERT_NOT_EQUAL(std::string::npos, html.find("保存しました"));
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_url_decode);
    RUN_TEST(test_url_decode_rejects_broken_percent);
    RUN_TEST(test_parse_form_ok);
    RUN_TEST(test_parse_form_trims_ssid_but_not_password);
    RUN_TEST(test_parse_form_field_order_and_extra);
    RUN_TEST(test_parse_form_errors);
    RUN_TEST(test_parse_form_boundaries);
    RUN_TEST(test_password_length_counts_characters_not_bytes);
    RUN_TEST(test_validate_decoded_values_are_not_decoded_again);
    RUN_TEST(test_html_escape_and_page_is_safe);
    RUN_TEST(test_page_never_contains_password_and_shows_form_or_saved);
    return UNITY_END();
}

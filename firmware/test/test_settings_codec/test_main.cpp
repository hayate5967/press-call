// 設定の応答の読み取りと保存形式のテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <string>

#include "settings_codec.h"

using namespace presscall;

namespace {

bool parse(const char* json, DeviceSettings& out) { return parseSettingsJson(json, out); }

}  // namespace

void setUp() {}
void tearDown() {}

void test_parse_fixed() {
    DeviceSettings s;
    TEST_ASSERT_TRUE(parse(
        R"({"version":1,"mode":"auto_signal","pause":{"mode":"fixed","fixedMs":1000},"stillThreshold":null})",
        s));
    TEST_ASSERT_EQUAL_UINT32(1, s.set.settingsVersion);
    TEST_ASSERT_EQUAL(Mode::AutoSignal, s.set.mode);
    TEST_ASSERT_EQUAL_UINT32(1000, s.set.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1000, s.set.pauseMaxMs);
    TEST_ASSERT_FALSE(s.hasStillThreshold);
}

void test_parse_random_with_spaces_and_key_order() {
    DeviceSettings s;
    TEST_ASSERT_TRUE(parse(
        "{ \"stillThreshold\" : 0.06 ,\n \"pause\": {\"maxMs\": 1500, \"mode\": \"random\", "
        "\"minMs\": 500}, \"mode\":\"auto_signal\", \"version\": 4 }",
        s));
    TEST_ASSERT_EQUAL_UINT32(4, s.set.settingsVersion);
    TEST_ASSERT_EQUAL_UINT32(500, s.set.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1500, s.set.pauseMaxMs);
    TEST_ASSERT_TRUE(s.hasStillThreshold);
    TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.06f, s.stillThreshold);
}

void test_parse_count_only() {
    DeviceSettings s;
    TEST_ASSERT_TRUE(
        parse(R"({"version":7,"mode":"count_only","pause":null,"stillThreshold":null})", s));
    TEST_ASSERT_EQUAL(Mode::CountOnly, s.set.mode);
    TEST_ASSERT_EQUAL_UINT32(7, s.set.settingsVersion);
}

void test_parse_ignores_unknown_keys() {
    DeviceSettings s;
    TEST_ASSERT_TRUE(parse(
        R"({"version":2,"extra":{"a":[1,"x",{"b":null}],"c":true},"mode":"count_only","pause":null,"stillThreshold":null,"updatedAt":"2026-11-17T00:00:00Z"})",
        s));
    TEST_ASSERT_EQUAL_UINT32(2, s.set.settingsVersion);
}

void test_parse_rejects_bad_input() {
    const char* bad[] = {
        "",
        "{",
        "not json",
        // 項目が足りない
        R"({"mode":"count_only","pause":null,"stillThreshold":null})",
        R"({"version":1,"pause":null,"stillThreshold":null})",
        // モードと待ち時間が合わない
        R"({"version":1,"mode":"auto_signal","pause":null,"stillThreshold":null})",
        R"({"version":1,"mode":"count_only","pause":{"mode":"fixed","fixedMs":1000},"stillThreshold":null})",
        // 範囲外・min > max
        R"({"version":1,"mode":"auto_signal","pause":{"mode":"fixed","fixedMs":100},"stillThreshold":null})",
        R"({"version":1,"mode":"auto_signal","pause":{"mode":"random","minMs":1500,"maxMs":500},"stillThreshold":null})",
        R"({"version":1,"mode":"auto_signal","pause":{"mode":"random","minMs":500,"maxMs":9000},"stillThreshold":null})",
        // 知らないモード・小数の version・しきい値が数でない
        R"({"version":1,"mode":"turbo","pause":null,"stillThreshold":null})",
        R"({"version":1.5,"mode":"count_only","pause":null,"stillThreshold":null})",
        R"({"version":1,"mode":"count_only","pause":null,"stillThreshold":"0.05"})",
        // 後ろにゴミ
        R"({"version":1,"mode":"count_only","pause":null,"stillThreshold":null} x)",
    };
    for (const char* json : bad) {
        DeviceSettings s = defaultDeviceSettings();
        TEST_ASSERT_FALSE_MESSAGE(parse(json, s), json);
        TEST_ASSERT_EQUAL_UINT32_MESSAGE(0, s.set.settingsVersion, "失敗したら out を変えない");
    }
}

void test_out_of_range_still_threshold_uses_default() {
    // 範囲外のしきい値だけを捨てて既定値にし、ほかの設定は使う。呼び出し側に知らせる
    const char* cases[] = {"0.15", "0.2", "0", "-0.1"};
    for (const char* v : cases) {
        const std::string json =
            std::string(R"({"version":3,"mode":"auto_signal","pause":{"mode":"fixed","fixedMs":1200},"stillThreshold":)") +
            v + "}";
        DeviceSettings s;
        bool ignored = false;
        TEST_ASSERT_TRUE_MESSAGE(parseSettingsJson(json, s, &ignored), v);
        TEST_ASSERT_TRUE_MESSAGE(ignored, v);
        TEST_ASSERT_FALSE(s.hasStillThreshold);
        TEST_ASSERT_EQUAL_UINT32(3, s.set.settingsVersion);
        TEST_ASSERT_EQUAL_UINT32(1200, s.set.pauseMinMs);
    }

    DeviceSettings s;
    bool ignored = true;
    TEST_ASSERT_TRUE(parseSettingsJson(
        R"({"version":3,"mode":"count_only","pause":null,"stillThreshold":0.149})", s, &ignored));
    TEST_ASSERT_FALSE(ignored);
    TEST_ASSERT_TRUE(s.hasStillThreshold);
}

void test_still_threshold_limit_matches_move_velocity() {
    TEST_ASSERT_EQUAL_FLOAT(DetectorConfig{}.moveVelocity, kStillThresholdMaxMps);
    TEST_ASSERT_EQUAL_FLOAT(0.15f, kStillThresholdMaxMps);  // packages/shared の STILL_THRESHOLD_MAX_MPS
    TEST_ASSERT_TRUE(isUsableStillThreshold(0.05f));
    TEST_ASSERT_FALSE(isUsableStillThreshold(0.15f));
}

void test_default_settings() {
    const DeviceSettings s = defaultDeviceSettings();
    TEST_ASSERT_EQUAL_UINT32(0, s.set.settingsVersion);
    TEST_ASSERT_EQUAL(Mode::AutoSignal, s.set.mode);
    TEST_ASSERT_EQUAL_UINT32(1000, s.set.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1000, s.set.pauseMaxMs);
    TEST_ASSERT_TRUE(isValidSettings(s));
}

void test_line_round_trip() {
    DeviceSettings s;
    s.set.settingsVersion = 9;
    s.set.mode = Mode::AutoSignal;
    s.set.pauseMinMs = 500;
    s.set.pauseMaxMs = 1500;
    s.hasStillThreshold = true;
    s.stillThreshold = 0.06f;

    constexpr uint32_t kFp = 0x1234abcd;
    DeviceSettings back;
    TEST_ASSERT_TRUE(decodeSettingsLine(encodeSettingsLine(s, kFp), kFp, back));
    TEST_ASSERT_EQUAL_UINT32(9, back.set.settingsVersion);
    TEST_ASSERT_EQUAL(Mode::AutoSignal, back.set.mode);
    TEST_ASSERT_EQUAL_UINT32(500, back.set.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1500, back.set.pauseMaxMs);
    TEST_ASSERT_TRUE(back.hasStillThreshold);
    TEST_ASSERT_FLOAT_WITHIN(0.0001f, 0.06f, back.stillThreshold);

    DeviceSettings countOnly;
    countOnly.set.mode = Mode::CountOnly;
    countOnly.set.pauseMinMs = countOnly.set.pauseMaxMs = 0;
    TEST_ASSERT_TRUE(decodeSettingsLine(encodeSettingsLine(countOnly, kFp), kFp, back));
    TEST_ASSERT_EQUAL(Mode::CountOnly, back.set.mode);
    TEST_ASSERT_FALSE(back.hasStillThreshold);
}

void test_line_keeps_still_threshold_precision() {
    DeviceSettings s = defaultDeviceSettings();
    s.hasStillThreshold = true;
    const float values[] = {0.06125f, 0.00004f, 0.1499f};
    for (float v : values) {
        s.stillThreshold = v;
        DeviceSettings back;
        TEST_ASSERT_TRUE(decodeSettingsLine(encodeSettingsLine(s, 1), 1, back));
        TEST_ASSERT_EQUAL_FLOAT(v, back.stillThreshold);  // 書いて読んでも同じ値
    }
}

void test_line_from_another_token_is_rejected() {
    const DeviceSettings s = defaultDeviceSettings();
    const std::string line = encodeSettingsLine(s, tokenFingerprint("dvt_old"));
    DeviceSettings out;
    TEST_ASSERT_TRUE(decodeSettingsLine(line, tokenFingerprint("dvt_old"), out));
    TEST_ASSERT_FALSE(decodeSettingsLine(line, tokenFingerprint("dvt_new"), out));
}

void test_token_fingerprint() {
    TEST_ASSERT_EQUAL_HEX32(0x811c9dc5, tokenFingerprint(""));    // FNV-1a の初期値
    TEST_ASSERT_EQUAL_HEX32(0xe40c292c, tokenFingerprint("a"));   // FNV-1a の既知の値
    TEST_ASSERT_NOT_EQUAL(tokenFingerprint("dvt_a"), tokenFingerprint("dvt_b"));
}

void test_line_rejects_broken() {
    DeviceSettings out;
    TEST_ASSERT_FALSE(decodeSettingsLine("", 1, out));
    TEST_ASSERT_FALSE(decodeSettingsLine("PST2 00000001 1 A 1000", 1, out));
    TEST_ASSERT_FALSE(decodeSettingsLine("PST2 00000001 1 X 1000 1000 0 0", 1, out));
    TEST_ASSERT_FALSE(decodeSettingsLine("PST2 00000001 1 A 100 1000 0 0", 1, out));   // 範囲外
    TEST_ASSERT_FALSE(decodeSettingsLine("PST2 00000001 1 A 1000 1000 1 0.2", 1, out)); // しきい値が上限以上
    TEST_ASSERT_FALSE(decodeSettingsLine("PST1 1 A 1000 1000 0 0.0000", 1, out));      // 古い形式
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_parse_fixed);
    RUN_TEST(test_parse_random_with_spaces_and_key_order);
    RUN_TEST(test_parse_count_only);
    RUN_TEST(test_parse_ignores_unknown_keys);
    RUN_TEST(test_parse_rejects_bad_input);
    RUN_TEST(test_out_of_range_still_threshold_uses_default);
    RUN_TEST(test_still_threshold_limit_matches_move_velocity);
    RUN_TEST(test_default_settings);
    RUN_TEST(test_line_round_trip);
    RUN_TEST(test_line_keeps_still_threshold_precision);
    RUN_TEST(test_line_from_another_token_is_rejected);
    RUN_TEST(test_token_fingerprint);
    RUN_TEST(test_line_rejects_broken);
    return UNITY_END();
}

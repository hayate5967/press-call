// 保存形式・JSON・時刻の補正・送信ルールのテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <string>

#include "send_policy.h"
#include "set_codec.h"

using namespace presscall;

namespace {

StoredSetHeader sampleHeader() {
    StoredSetHeader h;
    h.clientSetId = "c5d2e0f4-1234-4abc-8def-0123456789ab";
    h.bootId = 7;
    h.startedUptimeMs = 60000;
    h.endedUptimeMs = 89500;
    h.startedEpochMs = 0;
    h.settings.settingsVersion = 4;
    h.settings.mode = Mode::AutoSignal;
    h.settings.pauseMinMs = 500;
    h.settings.pauseMaxMs = 1500;
    return h;
}

SetRecord sampleSet(Mode mode, bool premature) {
    SetRecord s;
    s.settings.mode = mode;
    RepRecord r;
    r.startOffsetMs = 0;
    r.eccentricMs = 950;
    r.result.pauseTargetMs = 1130;
    r.result.pauseActualMs = 1190;
    r.result.reactionMs = premature ? 0 : 240;
    r.result.isPremature = premature;
    r.concentricMs = 1050;
    r.meanVelocityMps = 0.42f;
    r.peakVelocityMps = 0.71f;
    r.curveHz = 100;
    r.curve = {0.0f, 0.08f, 0.21f};
    s.reps.push_back(r);
    return s;
}

bool contains(const std::string& s, const char* part) { return s.find(part) != std::string::npos; }

}  // namespace

void setUp() {}
void tearDown() {}

void test_uuid_v4_sets_version_and_variant() {
    uint8_t bytes[16];
    for (int i = 0; i < 16; ++i) bytes[i] = 0xFF;
    TEST_ASSERT_EQUAL_STRING("ffffffff-ffff-4fff-bfff-ffffffffffff", formatUuidV4(bytes).c_str());
    for (int i = 0; i < 16; ++i) bytes[i] = 0x00;
    TEST_ASSERT_EQUAL_STRING("00000000-0000-4000-8000-000000000000", formatUuidV4(bytes).c_str());
}

void test_iso8601_formatting() {
    TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:00.000Z", formatIso8601Utc(0).c_str());
    TEST_ASSERT_EQUAL_STRING("2026-11-15T09:30:12.400Z",
                             formatIso8601Utc(1794735012400LL).c_str());
    TEST_ASSERT_EQUAL_STRING("2024-02-29T23:59:59.999Z",  // うるう日
                             formatIso8601Utc(1709251199999LL).c_str());
}

void test_header_round_trip() {
    StoredSetHeader h = sampleHeader();
    h.startedEpochMs = 1794735012400LL;
    StoredSetHeader back;
    TEST_ASSERT_TRUE(decodeHeader(encodeHeader(h), back));
    TEST_ASSERT_EQUAL_STRING(h.clientSetId.c_str(), back.clientSetId.c_str());
    TEST_ASSERT_EQUAL_UINT32(7, back.bootId);
    TEST_ASSERT_EQUAL_UINT64(60000, back.startedUptimeMs);
    TEST_ASSERT_EQUAL_UINT64(89500, back.endedUptimeMs);
    TEST_ASSERT_TRUE(back.startedEpochMs == 1794735012400LL);
    TEST_ASSERT_EQUAL_UINT32(4, back.settings.settingsVersion);
    TEST_ASSERT_EQUAL(Mode::AutoSignal, back.settings.mode);
    TEST_ASSERT_EQUAL_UINT32(500, back.settings.pauseMinMs);
    TEST_ASSERT_EQUAL_UINT32(1500, back.settings.pauseMaxMs);
}

void test_header_rejects_broken_lines() {
    StoredSetHeader out;
    TEST_ASSERT_FALSE(decodeHeader("", out));
    TEST_ASSERT_FALSE(decodeHeader("PCS1 short 1 2 3 0 0 A 1000 1000", out));
    std::string line = encodeHeader(sampleHeader());
    // 書き込み途中で切れた（項目が足りない）
    TEST_ASSERT_FALSE(decodeHeader(line.substr(0, line.rfind(' ')), out));
    TEST_ASSERT_FALSE(decodeHeader(line + " extra", out));
}

void test_reps_json_auto_signal() {
    const std::string json = encodeRepsJson(sampleSet(Mode::AutoSignal, false));
    TEST_ASSERT_EQUAL_STRING(
        "[{\"index\":1,\"startOffsetMs\":0,\"eccentricMs\":950,\"pauseTargetMs\":1130,"
        "\"pauseActualMs\":1190,\"reactionMs\":240,\"isPremature\":false,\"concentricMs\":1050,"
        "\"meanVelocityMps\":0.420,\"peakVelocityMps\":0.710,\"curveHz\":100,"
        "\"velocityCurve\":[0.00,0.08,0.21]}]",
        json.c_str());
}

void test_reps_json_premature_has_null_reaction() {
    const std::string json = encodeRepsJson(sampleSet(Mode::AutoSignal, true));
    TEST_ASSERT_TRUE(contains(json, "\"reactionMs\":null"));
    TEST_ASSERT_TRUE(contains(json, "\"isPremature\":true"));
}

void test_reps_json_count_only_has_no_signal_fields() {
    const std::string json = encodeRepsJson(sampleSet(Mode::CountOnly, false));
    TEST_ASSERT_TRUE(contains(json, "\"pauseTargetMs\":null"));
    TEST_ASSERT_TRUE(contains(json, "\"reactionMs\":null"));
    TEST_ASSERT_TRUE(contains(json, "\"isPremature\":false"));
}

void test_reps_json_drops_curves_over_budget() {
    SetRecord s = sampleSet(Mode::AutoSignal, false);
    s.reps[0].curve.assign(300, 0.5f);
    s.reps.push_back(s.reps[0]);
    const std::string json = encodeRepsJson(s, 2500);  // 1 レップ分のカーブしか入らない
    TEST_ASSERT_TRUE(json.size() <= 2500);
    TEST_ASSERT_TRUE(contains(json, "\"curveHz\":100,\"velocityCurve\":[0.50"));
    TEST_ASSERT_TRUE(contains(json, "\"curveHz\":null,\"velocityCurve\":null"));
}

void test_body_with_random_pause() {
    const StoredSetHeader h = sampleHeader();
    const std::string body = buildSetBody(h, 1794735012400LL, "[]");
    TEST_ASSERT_EQUAL_STRING(
        "{\"clientSetId\":\"c5d2e0f4-1234-4abc-8def-0123456789ab\",\"settingsVersion\":4,"
        "\"mode\":\"auto_signal\",\"pause\":{\"mode\":\"random\",\"minMs\":500,\"maxMs\":1500},"
        "\"startedAt\":\"2026-11-15T09:30:12.400Z\",\"endedAt\":\"2026-11-15T09:30:41.900Z\","
        "\"reps\":[]}",
        body.c_str());
}

void test_body_fixed_and_count_only() {
    StoredSetHeader h = sampleHeader();
    h.settings.pauseMinMs = h.settings.pauseMaxMs = 1000;
    TEST_ASSERT_TRUE(
        contains(buildSetBody(h, 0, "[]"), "\"pause\":{\"mode\":\"fixed\",\"fixedMs\":1000}"));
    h.settings.mode = Mode::CountOnly;
    TEST_ASSERT_TRUE(
        contains(buildSetBody(h, 0, "[]"), "\"mode\":\"count_only\",\"pause\":null"));
}

void test_time_known_at_record() {
    StoredSetHeader h = sampleHeader();
    h.startedEpochMs = 1794735012400LL;
    const auto r = resolveStartTime(h, 99, false, 0, 0);  // 別の起動・NTP 前でも使える
    TEST_ASSERT_EQUAL(TimeStatus::Ready, r.status);
    TEST_ASSERT_TRUE(r.startedEpochMs == 1794735012400LL);
}

void test_time_corrected_after_ntp_same_boot() {
    const StoredSetHeader h = sampleHeader();  // uptime 60 秒で記録、実時刻は不明
    TEST_ASSERT_EQUAL(TimeStatus::WaitForNtp, resolveStartTime(h, 7, false, 0, 100000).status);
    // uptime 100 秒の時点で現在時刻が分かった → 40 秒前が開始時刻
    const auto r = resolveStartTime(h, 7, true, 1794735052400LL, 100000);
    TEST_ASSERT_EQUAL(TimeStatus::Ready, r.status);
    TEST_ASSERT_TRUE(r.startedEpochMs == 1794735012400LL);
}

void test_time_unrecoverable_across_reboot() {
    const StoredSetHeader h = sampleHeader();
    const auto r = resolveStartTime(h, 8, true, 1794735052400LL, 5000);
    TEST_ASSERT_EQUAL(TimeStatus::Unrecoverable, r.status);
}

void test_classify_response() {
    TEST_ASSERT_EQUAL(SendOutcome::Delivered, classifyResponse(201, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Delivered, classifyResponse(200, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Rejected, classifyResponse(422, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Rejected, classifyResponse(400, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Rejected, classifyResponse(413, ""));
    TEST_ASSERT_EQUAL(SendOutcome::TokenRevoked,
                      classifyResponse(401, "{\"code\":\"device_token_revoked\"}"));
    TEST_ASSERT_EQUAL(SendOutcome::TokenInvalid,
                      classifyResponse(401, "{\"code\":\"device_token_invalid\"}"));
    TEST_ASSERT_EQUAL(SendOutcome::TokenInvalid, classifyResponse(401, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Retry, classifyResponse(503, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Retry, classifyResponse(500, ""));
    TEST_ASSERT_EQUAL(SendOutcome::Retry, classifyResponse(-1, ""));  // 通信失敗
}

void test_retry_delay_backs_off() {
    TEST_ASSERT_EQUAL_UINT32(0, retryDelayMs(0));
    TEST_ASSERT_EQUAL_UINT32(5000, retryDelayMs(1));
    TEST_ASSERT_EQUAL_UINT32(10000, retryDelayMs(2));
    TEST_ASSERT_EQUAL_UINT32(20000, retryDelayMs(3));
    TEST_ASSERT_EQUAL_UINT32(300000, retryDelayMs(10));
    TEST_ASSERT_EQUAL_UINT32(300000, retryDelayMs(1000));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_uuid_v4_sets_version_and_variant);
    RUN_TEST(test_iso8601_formatting);
    RUN_TEST(test_header_round_trip);
    RUN_TEST(test_header_rejects_broken_lines);
    RUN_TEST(test_reps_json_auto_signal);
    RUN_TEST(test_reps_json_premature_has_null_reaction);
    RUN_TEST(test_reps_json_count_only_has_no_signal_fields);
    RUN_TEST(test_reps_json_drops_curves_over_budget);
    RUN_TEST(test_body_with_random_pause);
    RUN_TEST(test_body_fixed_and_count_only);
    RUN_TEST(test_time_known_at_record);
    RUN_TEST(test_time_corrected_after_ntp_same_boot);
    RUN_TEST(test_time_unrecoverable_across_reboot);
    RUN_TEST(test_classify_response);
    RUN_TEST(test_retry_delay_backs_off);
    return UNITY_END();
}

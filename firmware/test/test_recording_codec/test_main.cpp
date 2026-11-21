// セットの開始・終了の指示の読み書きのテスト（PC 上で実行：pio test -e native）
#include <unity.h>

#include <string>

#include "recording_codec.h"

using namespace presscall;

void setUp() {}
void tearDown() {}

void test_parse_iso() {
    int64_t ms = 0;
    TEST_ASSERT_TRUE(parseIsoUtcMs("1970-01-01T00:00:00.000Z", ms));
    TEST_ASSERT_EQUAL_INT64(0, ms);
    TEST_ASSERT_TRUE(parseIsoUtcMs("2026-11-21T10:00:03.120Z", ms));
    TEST_ASSERT_EQUAL_INT64(1795255203120LL, ms);
    TEST_ASSERT_TRUE(parseIsoUtcMs("2024-02-29T23:59:59Z", ms));  // うるう日・小数なし
    TEST_ASSERT_EQUAL_INT64(1709251199000LL, ms);
    TEST_ASSERT_TRUE(parseIsoUtcMs("2026-11-21T10:00:03.1234Z", ms));  // 4 桁目以降は捨てる
    TEST_ASSERT_EQUAL_INT64(1795255203123LL, ms);
}

void test_parse_iso_rejects_bad_shapes() {
    int64_t ms = 0;
    TEST_ASSERT_FALSE(parseIsoUtcMs("2026-11-21 10:00:03Z", ms));
    TEST_ASSERT_FALSE(parseIsoUtcMs("2026-11-21T10:00:03+09:00", ms));
    TEST_ASSERT_FALSE(parseIsoUtcMs("2026-13-21T10:00:03Z", ms));
    TEST_ASSERT_FALSE(parseIsoUtcMs("2026-11-21T10:00:03.Z", ms));
    TEST_ASSERT_FALSE(parseIsoUtcMs("", ms));
}

void test_parse_recording() {
    RecordingCommand c;
    TEST_ASSERT_TRUE(parseRecordingJson(
        R"({"recording":true,"seq":12,"startedAt":"2026-11-21T10:00:03.120Z","stoppedAt":null,"serverTime":"2026-11-21T10:00:05.900Z"})",
        c));
    TEST_ASSERT_TRUE(c.recording);
    TEST_ASSERT_EQUAL_UINT32(12, c.seq);
    TEST_ASSERT_EQUAL_INT64(1795255203120LL, c.startedAtMs);
    TEST_ASSERT_EQUAL_INT64(-1, c.stoppedAtMs);
    TEST_ASSERT_EQUAL_INT64(1795255205900LL, c.serverTimeMs);
}

void test_parse_recording_never_pressed() {
    RecordingCommand c;
    TEST_ASSERT_TRUE(parseRecordingJson(
        R"({"recording":false,"seq":0,"startedAt":null,"stoppedAt":null,"serverTime":"2026-11-21T10:00:05.900Z","extra":[1,{"a":2}]})",
        c));
    TEST_ASSERT_FALSE(c.recording);
    TEST_ASSERT_EQUAL_UINT32(0, c.seq);
    TEST_ASSERT_EQUAL_INT64(-1, c.startedAtMs);
}

void test_parse_recording_rejects_missing_or_bad() {
    RecordingCommand c;
    TEST_ASSERT_FALSE(parseRecordingJson(R"({"recording":true,"seq":1})", c));  // serverTime がない
    TEST_ASSERT_FALSE(parseRecordingJson(
        R"({"recording":"yes","seq":1,"serverTime":"2026-11-21T10:00:05.900Z"})", c));
    TEST_ASSERT_FALSE(parseRecordingJson(
        R"({"recording":true,"seq":-1,"serverTime":"2026-11-21T10:00:05.900Z"})", c));
    TEST_ASSERT_FALSE(parseRecordingJson(
        R"({"recording":true,"seq":1.5,"serverTime":"2026-11-21T10:00:05.900Z"})", c));
    TEST_ASSERT_FALSE(parseRecordingJson("not json", c));
}

void test_server_time_to_uptime() {
    // 応答を受け取ったのが起動から 100 秒、サーバの時刻はその 2.78 秒前に押されたと言っている
    TEST_ASSERT_EQUAL_UINT64(97220, serverTimeToUptime(1000000, 1002780, 100000));
    // 起動より前に押されていたら 0
    TEST_ASSERT_EQUAL_UINT64(0, serverTimeToUptime(0, 500000, 100000));
    // サーバの時刻より後（あり得ないが）なら「今」
    TEST_ASSERT_EQUAL_UINT64(100000, serverTimeToUptime(2000, 1000, 100000));
}

void test_build_stop_body() {
    TEST_ASSERT_EQUAL_STRING("{\"recording\":false,\"seq\":12}", buildStopRecordingBody(12).c_str());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_parse_iso);
    RUN_TEST(test_parse_iso_rejects_bad_shapes);
    RUN_TEST(test_parse_recording);
    RUN_TEST(test_parse_recording_never_pressed);
    RUN_TEST(test_parse_recording_rejects_missing_or_bad);
    RUN_TEST(test_server_time_to_uptime);
    RUN_TEST(test_build_stop_body);
    return UNITY_END();
}

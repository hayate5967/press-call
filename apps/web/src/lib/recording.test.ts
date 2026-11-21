import type { RecordingState } from "@press-call/shared";
import { describe, expect, it } from "vitest";
import { ACK_TIMEOUT_MS, formatElapsed, recordingStatus } from "./recording";

const base: RecordingState = {
  recording: false,
  seq: 0,
  startedAt: null,
  stoppedAt: null,
  ackedSeq: 0,
  updatedAt: null,
};
const t = Date.parse("2026-11-21T10:00:00.000Z");

describe("recordingStatus", () => {
  it("一度も押していなければ停止中", () => {
    expect(recordingStatus(base, t, null)).toBe("idle");
  });

  it("押してデバイスに伝わるまでは「伝えている」、伝われば記録中・停止中", () => {
    const started = { ...base, recording: true, seq: 1, updatedAt: new Date(t).toISOString() };
    expect(recordingStatus(started, t + 3000, t)).toBe("sending");
    expect(recordingStatus({ ...started, ackedSeq: 1 }, t + 3000, t)).toBe("recording");
    const stopped = { ...started, recording: false, seq: 2, ackedSeq: 1 };
    expect(recordingStatus(stopped, t + 1000, t)).toBe("sending");
    expect(recordingStatus({ ...stopped, ackedSeq: 2 }, t + 1000, t)).toBe("idle");
  });

  it("押してから 15 秒たっても伝わらなければ「届いていない」", () => {
    const started = { ...base, recording: true, seq: 1, updatedAt: new Date(t).toISOString() };
    expect(recordingStatus(started, t + ACK_TIMEOUT_MS - 1, t)).toBe("sending");
    expect(recordingStatus(started, t + ACK_TIMEOUT_MS, t)).toBe("unreachable");
  });

  it("スマホで押した時刻がなければ（画面を開き直した）、サーバの updatedAt で測る", () => {
    const started = { ...base, recording: true, seq: 1, updatedAt: new Date(t).toISOString() };
    expect(recordingStatus(started, t + 20_000, null)).toBe("unreachable");
  });
});

describe("formatElapsed", () => {
  it("分:秒", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(42_900)).toBe("0:42");
    expect(formatElapsed(725_000)).toBe("12:05");
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

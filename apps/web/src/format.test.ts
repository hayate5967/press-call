import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("日本時間で表示する（UTC の 9:30 は 18:30）", () => {
    expect(formatDateTime("2026-11-15T09:30:00.000Z")).toBe("11/15 18:30");
  });

  it("日付が変わる時刻も日本時間の日付になる", () => {
    expect(formatDateTime("2026-11-15T15:05:00.000Z")).toBe("11/16 00:05");
  });
});

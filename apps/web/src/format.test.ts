import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatSessionDate,
  formatTime,
  formatVelocity,
  todayInJapan,
} from "./format";

describe("formatDateTime", () => {
  it("日本時間で表示する（UTC の 9:30 は 18:30）", () => {
    expect(formatDateTime("2026-11-15T09:30:00.000Z")).toBe("11/15 18:30");
  });

  it("日付が変わる時刻も日本時間の日付になる", () => {
    expect(formatDateTime("2026-11-15T15:05:00.000Z")).toBe("11/16 00:05");
  });
});

describe("formatTime", () => {
  it("日本時間の時刻だけを出す", () => {
    expect(formatTime("2026-11-15T09:30:00.000Z")).toBe("18:30");
  });
});

describe("formatSessionDate", () => {
  it("今年なら月日と曜日", () => {
    expect(formatSessionDate("2026-11-14", "2026-11-21")).toBe("11月14日（土）");
  });

  it("去年以前なら年も付ける", () => {
    expect(formatSessionDate("2025-12-31", "2026-01-02")).toBe("2025年12月31日（水）");
  });
});

describe("todayInJapan", () => {
  it("日本時間の日付を返す（UTC の 15:00 は翌日）", () => {
    expect(todayInJapan(new Date("2026-11-14T14:59:59.000Z"))).toBe("2026-11-14");
    expect(todayInJapan(new Date("2026-11-14T15:00:00.000Z"))).toBe("2026-11-15");
  });
});

describe("formatVelocity", () => {
  it("小数 2 桁。値がなければ —", () => {
    expect(formatVelocity(0.5)).toBe("0.50");
    expect(formatVelocity(0.625)).toBe("0.63");
    expect(formatVelocity(null)).toBe("—");
  });
});

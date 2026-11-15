import { describe, expect, it } from "vitest";
import { formatApiStatus } from "./format";

describe("formatApiStatus", () => {
  it("エラーがあればエラーを表示する", () => {
    expect(formatApiStatus(null, "timeout")).toBe("API に接続できません：timeout");
  });

  it("応答待ちの間は接続中と表示する", () => {
    expect(formatApiStatus(null, null)).toBe("API に接続中…");
  });

  it("応答があれば接続済みと表示する", () => {
    const health = { status: "ok" as const, time: "2026-11-15T09:30:00.000Z" };
    expect(formatApiStatus(health, null)).toContain("API に接続しました");
  });
});

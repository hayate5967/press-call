import type { NewSet } from "@press-call/shared";
import { describe, expect, it } from "vitest";
import { isIdle, LIVE_IDLE_MS, newSetsPath, takeFresh } from "./live-sets";

const set = (id: string): NewSet => ({
  id,
  sessionId: "00000000-0000-4000-8000-000000000000",
  startedAt: "2026-11-21T10:00:00.000Z",
  mode: "auto_signal",
  repCount: 5,
  weightKg: null,
});

describe("takeFresh", () => {
  it("まだ見ていないセットだけを返し、続けて同じセットが来ても 1 回だけにする", () => {
    const seen = new Set<string>();
    expect(takeFresh([set("a"), set("b")], seen).map((s) => s.id)).toEqual(["a", "b"]);
    expect(takeFresh([set("b"), set("c")], seen).map((s) => s.id)).toEqual(["c"]);
    expect(takeFresh([set("c")], seen)).toEqual([]);
  });
});

describe("newSetsPath", () => {
  it("最初は createdAfter を付けず、2 回目からは前回の serverTime を付ける", () => {
    expect(newSetsPath(null)).toBe("/sets");
    expect(newSetsPath("2026-11-21T10:00:00.000Z")).toBe(
      "/sets?createdAfter=2026-11-21T10%3A00%3A00.000Z",
    );
  });
});

describe("isIdle", () => {
  it("最後の動きから 30 分たったら止める", () => {
    const t = Date.parse("2026-11-21T10:00:00.000Z");
    expect(LIVE_IDLE_MS).toBe(30 * 60 * 1000);
    expect(isIdle(t, t + LIVE_IDLE_MS - 1)).toBe(false);
    expect(isIdle(t, t + LIVE_IDLE_MS)).toBe(true);
  });
});

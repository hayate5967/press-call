// 開発用の試しのセットが、デバイスが送るのと同じルール（createSetInputSchema）を満たすか
import { createSetInputSchema } from "@press-call/shared";
import { describe, expect, it } from "vitest";
import { sampleSetsForDay } from "../scripts/lib/sample-sets";

describe("sampleSetsForDay", () => {
  const day = new Date("2026-11-20T10:00:00.000Z");

  it("どのセットも POST /device/sets の入力として正しい", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const set of sampleSetsForDay(day, 4, seed)) {
        const result = createSetInputSchema.safeParse(set);
        expect(result.error?.issues ?? []).toEqual([]);
      }
    }
  });

  it("指定した数だけ、開始時刻の順に作る", () => {
    const sets = sampleSetsForDay(day, 3, 1);
    expect(sets).toHaveLength(3);
    expect(sets.map((s) => s.startedAt)).toEqual([
      "2026-11-20T10:00:00.000Z",
      "2026-11-20T10:04:00.000Z",
      "2026-11-20T10:08:00.000Z",
    ]);
  });

  it("同じ seed なら同じ記録（clientSetId 以外）になる", () => {
    const strip = (seed: number) =>
      sampleSetsForDay(day, 2, seed).map(({ clientSetId: _, ...rest }) => rest);
    expect(strip(7)).toEqual(strip(7));
  });
});

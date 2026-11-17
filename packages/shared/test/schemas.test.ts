import { describe, expect, it } from "vitest";
import { createSetInputSchema, deviceSettingsInputSchema, updateSetInputSchema } from "../src";

const baseSet = {
  clientSetId: "5b0e8f8a-3c2d-4b7e-9a1f-2d3c4b5a6f70",
  settingsVersion: 1,
  mode: "auto_signal" as const,
  pause: { mode: "fixed" as const, fixedMs: 1000 },
  startedAt: "2026-11-15T09:30:12.400Z",
  endedAt: "2026-11-15T09:30:41.900Z",
  reps: [
    {
      index: 1,
      startOffsetMs: 1200,
      eccentricMs: 950,
      pauseTargetMs: 1000,
      pauseActualMs: 1050,
      reactionMs: 240,
      isPremature: false,
      concentricMs: 1050,
      meanVelocityMps: 0.42,
      peakVelocityMps: 0.71,
      curveHz: 100,
      velocityCurve: [0, 0.1, 0.3],
    },
  ],
};

describe("createSetInputSchema", () => {
  it("正しいセットを受け付ける", () => {
    expect(createSetInputSchema.safeParse(baseSet).success).toBe(true);
  });

  it("自動合図モードで pause がないと弾く", () => {
    expect(createSetInputSchema.safeParse({ ...baseSet, pause: null }).success).toBe(false);
  });

  it("回数記録モードで pause があると弾く", () => {
    expect(createSetInputSchema.safeParse({ ...baseSet, mode: "count_only" }).success).toBe(false);
  });

  it("レップ番号が連番でないと弾く", () => {
    const reps = [{ ...baseSet.reps[0], index: 2 }];
    expect(createSetInputSchema.safeParse({ ...baseSet, reps }).success).toBe(false);
  });

  it("回数記録モードでレップに pauseTargetMs や reactionMs があると弾く", () => {
    const set = { ...baseSet, mode: "count_only" as const, pause: null };
    expect(createSetInputSchema.safeParse(set).success).toBe(false);
    const reps = [{ ...baseSet.reps[0], pauseTargetMs: null, reactionMs: null }];
    expect(createSetInputSchema.safeParse({ ...set, reps }).success).toBe(true);
  });

  it("開始が終了より後だと弾く", () => {
    const set = { ...baseSet, startedAt: baseSet.endedAt, endedAt: baseSet.startedAt };
    expect(createSetInputSchema.safeParse(set).success).toBe(false);
  });
});

describe("createSetInputSchema：DB の型に入らない値", () => {
  const rep = baseSet.reps[0] as (typeof baseSet.reps)[number];
  const withRep = (r: Partial<typeof rep>) => ({ ...baseSet, reps: [{ ...rep, ...r }] });

  it("int の上限（2147483647）を超える時間を弾く", () => {
    expect(createSetInputSchema.safeParse(withRep({ startOffsetMs: 2_147_483_647 })).success).toBe(
      true,
    );
    expect(createSetInputSchema.safeParse(withRep({ startOffsetMs: 3_000_000_000 })).success).toBe(
      false,
    );
  });

  it("smallint の上限（32767）を超える curveHz を弾く", () => {
    expect(createSetInputSchema.safeParse(withRep({ curveHz: 40_000 })).success).toBe(false);
  });

  it("real で表せないほど大きい速度を弾く", () => {
    expect(createSetInputSchema.safeParse(withRep({ velocityCurve: [0.1, 1e39] })).success).toBe(
      false,
    );
    expect(createSetInputSchema.safeParse(withRep({ peakVelocityMps: 1e39 })).success).toBe(false);
  });

  it("負の平均速度は引き続き弾く", () => {
    expect(createSetInputSchema.safeParse(withRep({ meanVelocityMps: -0.1 })).success).toBe(false);
  });
});

describe("createSetInputSchema：回数記録モードのフライング", () => {
  it("count_only で isPremature: true を弾く", () => {
    const rep = { ...baseSet.reps[0], pauseTargetMs: null, reactionMs: null };
    const set = { ...baseSet, mode: "count_only" as const, pause: null };
    expect(createSetInputSchema.safeParse({ ...set, reps: [rep] }).success).toBe(true);
    expect(
      createSetInputSchema.safeParse({ ...set, reps: [{ ...rep, isPremature: true }] }).success,
    ).toBe(false);
  });
});

describe("deviceSettingsInputSchema", () => {
  it("ランダムの min が max より大きいと弾く", () => {
    const input = {
      mode: "auto_signal",
      pause: { mode: "random", minMs: 1500, maxMs: 500 },
      stillThreshold: null,
    };
    expect(deviceSettingsInputSchema.safeParse(input).success).toBe(false);
  });

  it("待ち時間が範囲外だと弾く", () => {
    const input = {
      mode: "auto_signal",
      pause: { mode: "fixed", fixedMs: 10 },
      stillThreshold: null,
    };
    expect(deviceSettingsInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("updateSetInputSchema", () => {
  it("0.5kg 刻みの重量を受け付け、0.3kg 刻みは弾く", () => {
    expect(updateSetInputSchema.safeParse({ weightKg: 102.5 }).success).toBe(true);
    expect(updateSetInputSchema.safeParse({ weightKg: 102.3 }).success).toBe(false);
  });

  it("null で値を空に戻せる", () => {
    expect(updateSetInputSchema.safeParse({ rpe: null, note: null }).success).toBe(true);
  });
});

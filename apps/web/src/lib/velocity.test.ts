import type { RepSummary, SessionDetail } from "@press-call/shared";
import { describe, expect, it } from "vitest";
import { axisMax, distributionPoints, repValue } from "./velocity";

const rep = (
  index: number,
  mean: number | null,
  peak: number | null,
  premature = false,
): RepSummary => ({
  index,
  meanVelocityMps: mean,
  peakVelocityMps: peak,
  isPremature: premature,
  pauseActualMs: null,
  reactionMs: null,
});

const session = (sets: RepSummary[][]): SessionDetail => ({
  id: "00000000-0000-4000-8000-000000000000",
  date: "2026-11-21",
  sets: sets.map((reps, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    startedAt: "2026-11-21T10:00:00.000Z",
    mode: "auto_signal",
    weightKg: null,
    rpe: null,
    note: null,
    repCount: reps.length,
    reps,
  })),
});

describe("repValue", () => {
  it("MCV と PCV を選べる", () => {
    expect(repValue(rep(1, 0.5, 0.8), "mean")).toBe(0.5);
    expect(repValue(rep(1, 0.5, 0.8), "peak")).toBe(0.8);
  });
});

describe("axisMax", () => {
  it("その日の最大を 0.1 単位で切り上げる", () => {
    const s = session([[rep(1, 0.42, 0.71)], [rep(1, 0.61, 0.96)]]);
    expect(axisMax(s, "mean")).toBe(0.7);
    expect(axisMax(s, "peak")).toBe(1);
  });

  it("ちょうど 0.1 の倍数ならそのまま", () => {
    expect(axisMax(session([[rep(1, 0.6, null)]]), "mean")).toBe(0.6);
  });

  it("値がなければ 1.0", () => {
    expect(axisMax(session([[rep(1, null, null)]]), "mean")).toBe(1);
    expect(axisMax(session([[]]), "peak")).toBe(1);
  });
});

describe("distributionPoints", () => {
  it("セットごとに番号の左右へ並べ、速度のないレップは出さない", () => {
    const s = session([
      [rep(1, 0.5, 0.8), rep(2, null, 0.7), rep(3, 0.4, 0.6, true)],
      [rep(1, 0.6, 0.9)],
    ]);
    expect(distributionPoints(s, "mean")).toEqual([
      { set: 1, x: 1 - 0.08, rep: 1, v: 0.5, premature: false },
      { set: 1, x: 1 + 0.08, rep: 3, v: 0.4, premature: true },
      { set: 2, x: 2, rep: 1, v: 0.6, premature: false },
    ]);
  });

  it("レップが多くても、1 セットの点はセットの間隔の 6 割に収まる", () => {
    const reps = Array.from({ length: 21 }, (_, i) => rep(i + 1, 0.5, 0.8));
    const xs = distributionPoints(session([reps]), "mean").map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6);
  });
});

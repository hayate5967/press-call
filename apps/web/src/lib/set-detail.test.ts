import { describe, expect, it } from "vitest";
import { curvePoints, formatSeconds, pauseLabel } from "./set-detail";

describe("curvePoints", () => {
  it("サンプリング周波数から時刻を付ける（100Hz なら 10ms おき）", () => {
    expect(curvePoints({ curveHz: 100, velocityCurve: [0, 0.25, 0.5] })).toEqual([
      { t: 0, v: 0 },
      { t: 10, v: 0.25 },
      { t: 20, v: 0.5 },
    ]);
  });

  it("割り切れない周波数でも整数のミリ秒に丸める", () => {
    expect(curvePoints({ curveHz: 3, velocityCurve: [0, 0.1] })[1]).toEqual({ t: 333, v: 0.1 });
  });

  it("カーブや周波数がなければ空", () => {
    expect(curvePoints({ curveHz: null, velocityCurve: [0.1] })).toEqual([]);
    expect(curvePoints({ curveHz: 100, velocityCurve: null })).toEqual([]);
    expect(curvePoints({ curveHz: 0, velocityCurve: [0.1] })).toEqual([]);
  });
});

describe("formatSeconds", () => {
  it("小数 2 桁の秒。値がなければ —", () => {
    expect(formatSeconds(1190)).toBe("1.19 秒");
    expect(formatSeconds(0)).toBe("0.00 秒");
    expect(formatSeconds(null)).toBe("—");
  });
});

describe("pauseLabel", () => {
  it("固定・ランダム・回数記録", () => {
    expect(pauseLabel({ mode: "fixed", fixedMs: 1000 })).toBe("固定 1.0 秒");
    expect(pauseLabel({ mode: "random", minMs: 500, maxMs: 1500 })).toBe("ランダム 0.5〜1.5 秒");
    expect(pauseLabel(null)).toBe("なし（回数記録）");
  });
});

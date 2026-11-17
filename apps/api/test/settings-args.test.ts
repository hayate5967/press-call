// pnpm device:settings の引数の読み取りのテスト
import { describe, expect, it } from "vitest";
import { describeSettings, parseSettingsArgs } from "../scripts/lib/settings-args";

describe("parseSettingsArgs", () => {
  it("--fixed 1.0 → 自動合図・固定 1000ms", () => {
    expect(parseSettingsArgs({ fixed: "1.0" })).toEqual({
      ok: true,
      input: { mode: "auto_signal", pause: { mode: "fixed", fixedMs: 1000 }, stillThreshold: null },
    });
  });

  it("--random 0.5-1.5 → 自動合図・ランダム 500〜1500ms", () => {
    expect(parseSettingsArgs({ random: "0.5-1.5" })).toEqual({
      ok: true,
      input: {
        mode: "auto_signal",
        pause: { mode: "random", minMs: 500, maxMs: 1500 },
        stillThreshold: null,
      },
    });
  });

  it("--count-only --still 0.06 → 回数記録・しきい値つき", () => {
    expect(parseSettingsArgs({ countOnly: true, still: "0.06" })).toEqual({
      ok: true,
      input: { mode: "count_only", pause: null, stillThreshold: 0.06 },
    });
  });

  it.each([
    [{}, "どれか 1 つ"],
    [{ fixed: "1", countOnly: true }, "どれか 1 つ"],
    [{ fixed: "abc" }, "--fixed"],
    [{ fixed: "-1" }, "--fixed"],
    [{ fixed: "0.1" }, "0.2〜5.0"],
    [{ fixed: "6" }, "0.2〜5.0"],
    [{ random: "1.5" }, "--random"],
    [{ random: "1.5-0.5" }, "minMs は maxMs 以下"],
    [{ random: "0.5-9" }, "0.2〜5.0"],
    [{ fixed: "1", still: "0" }, "--still"],
    [{ fixed: "1", still: "0.15" }, "0.15 未満"], // 動き出しのしきい値と重なる
    [{ fixed: "1", still: "0.2" }, "0.15 未満"],
  ])("%o はエラー（%s）", (args, message) => {
    const result = parseSettingsArgs(args);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});

describe("describeSettings", () => {
  it("人が読める形にする", () => {
    expect(
      describeSettings({
        version: 3,
        mode: "auto_signal",
        pause: { mode: "random", minMs: 500, maxMs: 1500 },
        stillThreshold: null,
      }),
    ).toBe("自動合図・ランダム 0.5〜1.5 秒、静止のしきい値: 既定値（version 3）");
    expect(describeSettings({ mode: "count_only", pause: null, stillThreshold: 0.06 })).toBe(
      "回数記録（合図なし）、静止のしきい値: 0.06 m/s",
    );
  });
});

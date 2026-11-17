import { describe, expect, it } from "vitest";
import { fromForm, type SettingsForm, toForm } from "./settings-form";

const base: SettingsForm = {
  mode: "auto_signal",
  pauseMode: "fixed",
  fixedSec: "1",
  minSec: "0.5",
  maxSec: "1.5",
  stillThreshold: "",
};

describe("設定フォーム", () => {
  it("API の設定を秒の表示にする", () => {
    expect(
      toForm({
        version: 3,
        mode: "auto_signal",
        pause: { mode: "random", minMs: 500, maxMs: 1500 },
        stillThreshold: 0.05,
      }),
    ).toMatchObject({ pauseMode: "random", minSec: "0.5", maxSec: "1.5", stillThreshold: "0.05" });
  });

  it("固定：秒をミリ秒にする", () => {
    expect(fromForm({ ...base, fixedSec: "1.2" })).toEqual({
      ok: true,
      input: { mode: "auto_signal", pause: { mode: "fixed", fixedMs: 1200 }, stillThreshold: null },
    });
  });

  it("ランダム：最短と最長", () => {
    const r = fromForm({ ...base, pauseMode: "random" });
    expect(r).toMatchObject({
      ok: true,
      input: { pause: { mode: "random", minMs: 500, maxMs: 1500 } },
    });
  });

  it("回数記録モードは pause を送らない（null）", () => {
    expect(fromForm({ ...base, mode: "count_only", fixedSec: "abc" })).toEqual({
      ok: true,
      input: { mode: "count_only", pause: null, stillThreshold: null },
    });
  });

  it("範囲外・数でない・最短 > 最長は、どの欄が悪いかを返す", () => {
    expect(fromForm({ ...base, fixedSec: "0.1" })).toMatchObject({
      ok: false,
      errors: { fixedSec: expect.any(String) },
    });
    expect(fromForm({ ...base, fixedSec: "" })).toMatchObject({ ok: false });
    expect(fromForm({ ...base, pauseMode: "random", minSec: "2", maxSec: "1" })).toMatchObject({
      ok: false,
      errors: { minSec: expect.any(String) },
    });
    expect(fromForm({ ...base, stillThreshold: "0.2" })).toMatchObject({
      ok: false,
      errors: { stillThreshold: expect.any(String) },
    });
  });
});

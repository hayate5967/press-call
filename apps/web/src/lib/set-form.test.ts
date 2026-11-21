import { describe, expect, it } from "vitest";
import { fromSetForm, isSetFormChanged, parseWeight, rpeChoices, toSetForm } from "./set-form";

describe("toSetForm", () => {
  it("未入力は空の文字列と null", () => {
    expect(toSetForm({ weightKg: null, rpe: null, note: null })).toEqual({
      weight: "",
      rpe: null,
      note: "",
    });
    expect(toSetForm({ weightKg: 102.5, rpe: 8, note: "良い" })).toEqual({
      weight: "102.5",
      rpe: 8,
      note: "良い",
    });
  });
});

describe("parseWeight", () => {
  it("半角・全角の数字と小数点を読む。空なら null、数でなければ NaN", () => {
    expect(parseWeight("100")).toBe(100);
    expect(parseWeight(" 102.5 ")).toBe(102.5);
    expect(parseWeight("１００．５")).toBe(100.5);
    expect(parseWeight("100,5")).toBe(100.5);
    expect(parseWeight("")).toBeNull();
    expect(parseWeight("abc")).toBeNaN();
    expect(parseWeight("-5")).toBeNaN();
    expect(parseWeight("1e2")).toBeNaN();
  });
});

describe("fromSetForm", () => {
  it("API に送る形にする。空のメモは null、前後の空白は落とす", () => {
    expect(fromSetForm({ weight: "100", rpe: 8.5, note: "  波打った " })).toEqual({
      ok: true,
      input: { weightKg: 100, rpe: 8.5, note: "波打った" },
    });
    expect(fromSetForm({ weight: "", rpe: null, note: "  " })).toEqual({
      ok: true,
      input: { weightKg: null, rpe: null, note: null },
    });
  });

  it("重量が数でない・範囲外・0.5 刻みでない、メモが長すぎるときはエラー", () => {
    expect(fromSetForm({ weight: "abc", rpe: null, note: "" })).toMatchObject({
      ok: false,
      errors: { weight: expect.any(String) },
    });
    expect(fromSetForm({ weight: "100.2", rpe: null, note: "" })).toMatchObject({
      ok: false,
      errors: { weight: expect.any(String) },
    });
    expect(fromSetForm({ weight: "501", rpe: null, note: "" })).toMatchObject({ ok: false });
    expect(fromSetForm({ weight: "", rpe: null, note: "あ".repeat(501) })).toMatchObject({
      ok: false,
      errors: { note: expect.any(String) },
    });
  });
});

describe("isSetFormChanged", () => {
  const saved = { weight: "100", rpe: 8, note: "メモ" };
  it("書き方が違うだけ（100 と 100.0、前後の空白）は変わっていない扱い", () => {
    expect(isSetFormChanged(saved, { weight: "100.0", rpe: 8, note: " メモ " })).toBe(false);
  });
  it("値が変われば true", () => {
    expect(isSetFormChanged(saved, { ...saved, weight: "102.5" })).toBe(true);
    expect(isSetFormChanged(saved, { ...saved, rpe: null })).toBe(true);
    expect(isSetFormChanged(saved, { ...saved, note: "" })).toBe(true);
  });
});

describe("rpeChoices", () => {
  it("6〜10 を 0.5 刻み。保存済みの値がその外なら足す", () => {
    expect(rpeChoices(null)).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
    expect(rpeChoices(8)).toHaveLength(9);
    expect(rpeChoices(4.5)[0]).toBe(4.5);
  });
});

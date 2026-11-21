import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo（ログイン後に戻る先）", () => {
  it("同じサイトのパスだけを通す", () => {
    expect(safeReturnTo("/devices/pair?code=BCDF-GHJK")).toBe("/devices/pair?code=BCDF-GHJK");
  });

  it.each([
    null,
    "",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
  ])("%s は通さない（外のサイトへ飛ばさない）", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});

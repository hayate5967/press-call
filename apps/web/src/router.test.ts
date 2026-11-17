import { describe, expect, it } from "vitest";
import { matchRoute, safeReturnTo } from "./router";

describe("matchRoute", () => {
  const id = "3f0a2b1c-1111-4222-8333-444455556666";
  it.each([
    ["/", { name: "home" }],
    ["/login", { name: "login" }],
    ["/devices/pair", { name: "pair" }],
    ["/devices/pair/", { name: "pair" }],
    [`/devices/${id}/settings`, { name: "settings", deviceId: id }],
    ["/devices/abc/settings", { name: "notFound" }],
    ["/unknown", { name: "notFound" }],
  ])("%s", (path, expected) => {
    expect(matchRoute(path)).toEqual(expected);
  });
});

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

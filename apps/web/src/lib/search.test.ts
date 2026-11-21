import { describe, expect, it } from "vitest";
import { isUuid, parseLoginSearch, parsePairSearch } from "./search";

describe("parseLoginSearch", () => {
  it("error と知っている reason を読む", () => {
    expect(parseLoginSearch({ error: "oauth_denied", reason: "logged_out" })).toEqual({
      error: "oauth_denied",
      reason: "logged_out",
    });
  });

  it("知らない reason や文字列でない値は捨てる", () => {
    expect(parseLoginSearch({ error: 1, reason: "hacked" })).toEqual({});
  });
});

describe("parsePairSearch", () => {
  it("コードを文字列で読む", () => {
    expect(parsePairSearch({ code: "BCDF-GHJK" })).toEqual({ code: "BCDF-GHJK" });
  });

  it("数字として読まれた値も文字列にする", () => {
    expect(parsePairSearch({ code: 1234 })).toEqual({ code: "1234" });
  });

  it("なければ空", () => {
    expect(parsePairSearch({})).toEqual({});
  });
});

describe("isUuid", () => {
  it.each([
    ["3f0a2b1c-1111-4222-8333-444455556666", true],
    ["abc", false],
    ["3f0a2b1c-1111-4222-8333-44445555666", false],
  ])("%s → %s", (value, expected) => {
    expect(isUuid(value)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { activeTab } from "./app-shell";

describe("activeTab（下部タブのどれを光らせるか）", () => {
  it.each([
    ["/", "/"],
    ["/history", "/history"],
    ["/settings", "/settings"],
    ["/devices/pair", "/settings"],
    ["/devices/3f0a2b1c-1111-4222-8333-444455556666/settings", "/settings"],
    ["/unknown", null],
  ])("%s → %s", (pathname, expected) => {
    expect(activeTab(pathname)).toBe(expected);
  });
});

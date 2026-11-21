import type { Device } from "@press-call/shared";
import { describe, expect, it } from "vitest";
import { connectedDeviceLabels } from "./devices";

function device(overrides: Partial<Device>): Device {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "部室のデバイス",
    lastSeenAt: null,
    active: true,
    createdAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("connectedDeviceLabels", () => {
  it("接続済みのデバイスを名前と最終通信（日本時間）で出す", () => {
    expect(
      connectedDeviceLabels([device({ name: "部室", lastSeenAt: "2026-11-20T12:30:00.000Z" })]),
    ).toEqual(["部室（最終通信 11/20 21:30）"]);
  });

  it("まだ通信していなければそう出す", () => {
    expect(connectedDeviceLabels([device({ name: "部室" })])).toEqual(["部室（まだ通信なし）"]);
  });

  it("無効になったデバイスは出さない", () => {
    expect(
      connectedDeviceLabels([
        device({ name: "古い", active: false }),
        device({ name: "今の", lastSeenAt: "2026-11-20T12:30:00.000Z" }),
      ]),
    ).toEqual(["今の（最終通信 11/20 21:30）"]);
  });

  it("デバイスがなければ空", () => {
    expect(connectedDeviceLabels([])).toEqual([]);
  });
});

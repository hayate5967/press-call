// デバイスの一覧から画面に出す情報を作る
import type { Device } from "@press-call/shared";
import { formatDateTime } from "./format";

/** 使えるデバイスと、失効済みのデバイスに分ける（並びはそのまま）。失効済みは一覧で畳んで見せる */
export function splitDevices(devices: readonly Device[]): { usable: Device[]; revoked: Device[] } {
  return {
    usable: devices.filter((d) => d.active),
    revoked: devices.filter((d) => !d.active),
  };
}

/**
 * 「デバイスを追加する」の上に出す、接続済み（有効なトークンがある）デバイスの一覧。
 * 例：「部室のデバイス（最終通信 11/20 21:30）」。無効になったデバイスは含めない
 */
export function connectedDeviceLabels(devices: readonly Device[]): string[] {
  return devices
    .filter((d) => d.active)
    .map((d) => {
      const seen = d.lastSeenAt ? `最終通信 ${formatDateTime(d.lastSeenAt)}` : "まだ通信なし";
      return `${d.name}（${seen}）`;
    });
}

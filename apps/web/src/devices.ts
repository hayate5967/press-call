// デバイスの一覧から画面に出す情報を作る
import type { Device } from "@press-call/shared";
import { formatDateTime } from "./format";

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

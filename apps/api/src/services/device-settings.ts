// デバイスの設定の業務ルール（API 仕様書 5 章 GET /device/settings、6 章 PUT /devices/{id}/settings）
import type { DeviceSettings, DeviceSettingsInput } from "@press-call/shared";
import type { Db } from "../db/client";
import {
  findDeviceSettings,
  insertDeviceSettingsIfAbsent,
  replaceDeviceSettings,
} from "../repositories/device-settings";

/** デバイスを作ったときの設定（自動合図・固定 1.0 秒。ファームが設定を取れないときの既定値と同じ） */
export const DEFAULT_DEVICE_SETTINGS: DeviceSettingsInput = {
  mode: "auto_signal",
  pause: { mode: "fixed", fixedMs: 1000 },
  stillThreshold: null,
};

/** デバイスの初期設定の行を作る（ペアリング・開発用スクリプトでデバイスを作ったとき） */
export function createDefaultDeviceSettings(db: Db, deviceId: string): Promise<void> {
  return insertDeviceSettingsIfAbsent(db, deviceId, DEFAULT_DEVICE_SETTINGS);
}

/**
 * デバイスの設定を返す。
 * 設定の行がないデバイス（初期設定を作る前に登録したもの）は、ここで初期値の行を作ってから返す
 */
export async function getDeviceSettings(db: Db, deviceId: string): Promise<DeviceSettings> {
  const found = await findDeviceSettings(db, deviceId);
  if (found) return found;
  await createDefaultDeviceSettings(db, deviceId);
  const created = await findDeviceSettings(db, deviceId);
  if (!created) throw new Error("設定を作れませんでした");
  return created;
}

/** 設定をまるごと置き換える。version が進むので、ESP32 は次の問い合わせで新しい設定を受け取る */
export function updateDeviceSettings(
  db: Db,
  deviceId: string,
  input: DeviceSettingsInput,
): Promise<DeviceSettings> {
  return replaceDeviceSettings(db, deviceId, input);
}

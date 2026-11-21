// ユーザーが自分のデバイスを扱うときの共通ルール（API 仕様書 6 章）

import type { Device } from "@press-call/shared";
import type { Db } from "../db/client";
import { ApiError } from "../middleware/error";
import {
  type DeviceSummary,
  findOwnedDevice,
  isOwnedDevice,
  renameOwnedDevice,
  revokeDeviceTokens,
} from "../repositories/devices";

/**
 * 自分のデバイスでなければ 404 にする。
 * 他人のデバイスでも 403 ではなく 404 を返し、「その ID が存在すること」自体を漏らさない
 */
export async function assertOwnedDevice(db: Db, userId: string, deviceId: string): Promise<void> {
  if (!(await isOwnedDevice(db, userId, deviceId))) {
    throw new ApiError(404, "not_found", "見つかりません");
  }
}

/** DB の行を API の形（日時は ISO 8601 の文字列）にする */
export function toDevice(d: DeviceSummary): Device {
  return {
    ...d,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

/** デバイスの名前を変え、変えたあとのデバイスを返す（PATCH /devices/{id}） */
export async function renameDevice(
  db: Db,
  userId: string,
  deviceId: string,
  name: string,
): Promise<Device> {
  if (!(await renameOwnedDevice(db, userId, deviceId, name))) {
    throw new ApiError(404, "not_found", "見つかりません");
  }
  const device = await findOwnedDevice(db, userId, deviceId);
  if (!device) throw new ApiError(404, "not_found", "見つかりません");
  return toDevice(device);
}

/**
 * デバイスを使えなくする（POST /devices/{id}/revoke、盗難・紛失時）。
 * トークンをすべて失効させ、以降 ESP32 は 401 device_token_revoked を受け取る。記録は消さない。
 * もう失効しているデバイスでも 204（同じ結果になるので何度呼んでもよい）
 */
export async function revokeDevice(db: Db, userId: string, deviceId: string): Promise<void> {
  await assertOwnedDevice(db, userId, deviceId);
  await revokeDeviceTokens(db, deviceId);
}

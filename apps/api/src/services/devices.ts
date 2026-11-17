// ユーザーが自分のデバイスを扱うときの共通ルール（API 仕様書 6 章）
import type { Db } from "../db/client";
import { ApiError } from "../middleware/error";
import { isOwnedDevice } from "../repositories/devices";

/**
 * 自分のデバイスでなければ 404 にする。
 * 他人のデバイスでも 403 ではなく 404 を返し、「その ID が存在すること」自体を漏らさない
 */
export async function assertOwnedDevice(db: Db, userId: string, deviceId: string): Promise<void> {
  if (!(await isOwnedDevice(db, userId, deviceId))) {
    throw new ApiError(404, "not_found", "見つかりません");
  }
}

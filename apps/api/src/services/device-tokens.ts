// デバイストークンの発行（開発用スクリプト・テスト、今後のペアリングで共通に使う）
import type { Db } from "../db/client";
import { generateDeviceToken, hashDeviceToken } from "../lib/device-token";
import { insertDeviceToken } from "../repositories/devices";

/**
 * デバイスにトークンを発行する。DB にはハッシュだけを保存し、平文は戻り値でだけ返す。
 * 平文は呼び出し側で一度だけ相手（ESP32・画面）に渡し、どこにも保存しないこと
 */
export async function issueDeviceToken(
  db: Db,
  deviceId: string,
): Promise<{ token: string; tokenId: string }> {
  const token = generateDeviceToken();
  const tokenId = await insertDeviceToken(db, deviceId, await hashDeviceToken(token));
  return { token, tokenId };
}

// デバイスとデバイストークンの DB アクセス
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { devices, deviceTokens } from "../db/schema";

export type DeviceTokenOwner = {
  tokenId: string;
  deviceId: string;
  userId: string;
  revokedAt: Date | null;
};

type FoundRow = {
  token_id: string;
  device_id: string;
  user_id: string;
  revoked_at: Date | string | null;
};

/** 「最後に使われた時刻」を書き直すのは、前回からこの間隔より空いたときだけにする */
export const TOUCH_INTERVAL = "1 minute";

/**
 * トークンのハッシュから、そのトークンとデバイス・持ち主を探す（失効済みも返す）。
 * 失効していなければ、同じ SQL 文の中で devices.last_seen_at と device_tokens.last_used_at も更新する。
 * ESP32 は設定を数秒おきに問い合わせるので、前回の更新から 1 分以内なら書かない（DB の書き込みを減らす）。
 * 照合と更新を 1 文にまとめ、DB との往復を 1 回にしている
 */
export async function findAndTouchDevice(
  db: Db,
  tokenHash: string,
): Promise<DeviceTokenOwner | undefined> {
  const result = (await db.execute(sql`
    with found as (
      select t.id as token_id, d.id as device_id, d.user_id, t.revoked_at
      from ${deviceTokens} t
      join ${devices} d on d.id = t.device_id
      where t.token_hash = ${tokenHash}
    ),
    touch_token as (
      update ${deviceTokens} set last_used_at = now()
      where id = (select token_id from found where revoked_at is null)
        and (last_used_at is null or last_used_at < now() - ${TOUCH_INTERVAL}::interval)
      returning 1
    ),
    touch_device as (
      update ${devices} set last_seen_at = now()
      where id = (select device_id from found where revoked_at is null)
        and (last_seen_at is null or last_seen_at < now() - ${TOUCH_INTERVAL}::interval)
      returning 1
    )
    select token_id, device_id, user_id, revoked_at from found
  `)) as unknown as { rows: FoundRow[] }; // node-postgres も PGlite も { rows } を返す
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    tokenId: row.token_id,
    deviceId: row.device_id,
    userId: row.user_id,
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at),
  };
}

/** デバイストークンのハッシュを保存する。平文はここに渡さない */
export async function insertDeviceToken(db: Db, deviceId: string, tokenHash: string) {
  const [row] = await db
    .insert(deviceTokens)
    .values({ deviceId, tokenHash })
    .returning({ id: deviceTokens.id });
  if (!row) throw new Error("デバイストークンを保存できませんでした");
  return row.id;
}

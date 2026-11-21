// デバイスとデバイストークンの DB アクセス
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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

/** デバイスを作る（ペアリングの許可時） */
export async function insertDevice(db: Db, userId: string, name: string): Promise<string> {
  const [row] = await db.insert(devices).values({ userId, name }).returning({ id: devices.id });
  if (!row) throw new Error("デバイスを作れませんでした");
  return row.id;
}

export type DeviceSummary = {
  id: string;
  name: string;
  lastSeenAt: Date | null;
  active: boolean;
  createdAt: Date;
};

// 副問い合わせの中では Drizzle が ${devices.id} を表名なしの "id" にしてしまい、t.id と取り違える。
// そのため外側の表の列は "devices"."id" と表名つきで書く
const activeColumn = sql<boolean>`exists (
  select 1 from ${deviceTokens} t where t.device_id = "devices"."id" and t.revoked_at is null
)`;

/** 持ち主のデバイスの一覧（新しい順）。active は有効なトークンがあるか */
export async function listDevices(db: Db, userId: string): Promise<DeviceSummary[]> {
  return db
    .select({
      id: devices.id,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
      active: activeColumn,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.createdAt));
}

/** 持ち主のデバイスなら true（他人のデバイス・存在しないデバイスは区別しない） */
export async function isOwnedDevice(db: Db, userId: string, deviceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
  return row !== undefined;
}

/** 持ち主のデバイス 1 件（一覧と同じ形）。他人のデバイス・存在しないデバイスは undefined */
export async function findOwnedDevice(
  db: Db,
  userId: string,
  deviceId: string,
): Promise<DeviceSummary | undefined> {
  const [row] = await db
    .select({
      id: devices.id,
      name: devices.name,
      lastSeenAt: devices.lastSeenAt,
      active: activeColumn,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
  return row;
}

/** デバイスの名前を変える。変えたら true（他人のデバイス・存在しないデバイスは false） */
export async function renameOwnedDevice(
  db: Db,
  userId: string,
  deviceId: string,
  name: string,
): Promise<boolean> {
  const rows = await db
    .update(devices)
    .set({ name })
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

/**
 * デバイスのトークンをすべて失効させる（まだ失効していないものだけ revoked_at を入れる）。
 * 行は消さない（いつ失効したかを残す。data-design.md「トークンは削除せず失効日時を入れる」）
 */
export async function revokeDeviceTokens(db: Db, deviceId: string): Promise<void> {
  await db
    .update(deviceTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(deviceTokens.deviceId, deviceId), isNull(deviceTokens.revokedAt)));
}

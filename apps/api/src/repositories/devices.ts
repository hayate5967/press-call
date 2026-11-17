// デバイスとデバイストークンの DB アクセス
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { devices, deviceTokens } from "../db/schema";

export type DeviceTokenOwner = {
  tokenId: string;
  deviceId: string;
  userId: string;
  revokedAt: Date | null;
};

/** トークンのハッシュから、そのトークンとデバイス・持ち主を探す（失効済みも返す） */
export async function findDeviceByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<DeviceTokenOwner | undefined> {
  const [row] = await db
    .select({
      tokenId: deviceTokens.id,
      deviceId: devices.id,
      userId: devices.userId,
      revokedAt: deviceTokens.revokedAt,
    })
    .from(deviceTokens)
    .innerJoin(devices, eq(deviceTokens.deviceId, devices.id))
    .where(eq(deviceTokens.tokenHash, tokenHash));
  return row;
}

/** デバイスが API を呼んだことを記録する（devices.last_seen_at と device_tokens.last_used_at） */
export async function touchDevice(db: Db, deviceId: string, tokenId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(devices).set({ lastSeenAt: sql`now()` }).where(eq(devices.id, deviceId));
    await tx
      .update(deviceTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(deviceTokens.id, tokenId));
  });
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

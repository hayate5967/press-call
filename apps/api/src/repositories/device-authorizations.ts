// ペアリング（RFC 8628）の途中状態の DB アクセス
//
// 状態の移り変わり：pending →（ユーザーが許可）approved →（ESP32 がトークンを受け取る）consumed
//                   pending →（ユーザーが拒否）denied
// 状態を変える UPDATE は「今の状態が○○なら」という条件付きにして、同時に来ても 1 回しか成功しないようにする。
// 期限の判定は DB の now() で行う
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { deviceAuthorizations } from "../db/schema";

/** コードの有効期限（RFC 8628 の expires_in。API 仕様書 4 章） */
export const PAIRING_TTL_SECONDS = 600;

/** ESP32 が問い合わせる間隔（秒） */
export const POLL_INTERVAL_SECONDS = 5;

/**
 * これより短い間隔の問い合わせは slow_down にする。
 * 通信の揺らぎで少し早く届くこともあるので、interval より 1 秒だけ甘くする
 */
export const SLOW_DOWN_BELOW = `${POLL_INTERVAL_SECONDS - 1} seconds`;

type Status = (typeof deviceAuthorizations.$inferSelect)["status"];

export type AuthorizationState = {
  id: string;
  status: Status;
  expired: boolean;
  deviceId: string | null;
};

/** 新しいペアリングを作る。userCode が他と重なったら false（呼び出し側で作り直す） */
export async function insertAuthorization(
  db: Db,
  input: { deviceCodeHash: string; userCode: string },
): Promise<boolean> {
  const rows = await db
    .insert(deviceAuthorizations)
    .values({
      ...input,
      status: "pending",
      expiresAt: sql`now() + ${PAIRING_TTL_SECONDS} * interval '1 second'`,
    })
    .onConflictDoNothing({ target: deviceAuthorizations.userCode })
    .returning({ id: deviceAuthorizations.id });
  return rows.length > 0;
}

const stateColumns = {
  id: deviceAuthorizations.id,
  status: deviceAuthorizations.status,
  expired: sql<boolean>`${deviceAuthorizations.expiresAt} <= now()`,
  deviceId: deviceAuthorizations.deviceId,
};

export async function findByUserCode(
  db: Db,
  userCode: string,
): Promise<AuthorizationState | undefined> {
  const [row] = await db
    .select(stateColumns)
    .from(deviceAuthorizations)
    .where(eq(deviceAuthorizations.userCode, userCode));
  return row;
}

/**
 * ESP32 の問い合わせを記録し、状態を返す。
 * tooFast は「前回の問い合わせから interval 未満」（RFC 8628 の slow_down）
 */
export async function recordPoll(
  db: Db,
  deviceCodeHash: string,
): Promise<(AuthorizationState & { tooFast: boolean }) | undefined> {
  // 更新前の last_polled_at と比べたいので、FROM で更新前の行を参照する
  const result = (await db.execute(sql`
    update ${deviceAuthorizations} a set last_polled_at = now()
    from ${deviceAuthorizations} prev
    where a.id = prev.id and a.device_code_hash = ${deviceCodeHash}
    returning a.id, a.status, a.expires_at <= now() as expired, a.device_id,
      coalesce(prev.last_polled_at > now() - ${SLOW_DOWN_BELOW}::interval, false) as too_fast
  `)) as unknown as {
    rows: {
      id: string;
      status: Status;
      expired: boolean;
      device_id: string | null;
      too_fast: boolean;
    }[];
  };
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    status: row.status,
    expired: row.expired,
    deviceId: row.device_id,
    tooFast: row.too_fast,
  };
}

/**
 * 許可する（pending で期限内のときだけ）。できたら true。
 * 許可した時点から、ESP32 がトークンを受け取れる期限を 10 分に延ばす。
 * 期限ぎりぎりに許可すると、ESP32 の次の問い合わせが期限を過ぎ、使われないデバイスが残るため
 */
export async function markApproved(
  db: Db,
  id: string,
  input: { userId: string; deviceId: string; deviceName: string },
): Promise<boolean> {
  const rows = await db
    .update(deviceAuthorizations)
    .set({
      status: "approved",
      ...input,
      expiresAt: sql`now() + ${PAIRING_TTL_SECONDS} * interval '1 second'`,
    })
    .where(
      and(
        eq(deviceAuthorizations.id, id),
        eq(deviceAuthorizations.status, "pending"),
        sql`${deviceAuthorizations.expiresAt} > now()`,
      ),
    )
    .returning({ id: deviceAuthorizations.id });
  return rows.length > 0;
}

/** 拒否する（pending で期限内のときだけ）。できたら true */
export async function markDenied(db: Db, id: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(deviceAuthorizations)
    .set({ status: "denied", userId })
    .where(
      and(
        eq(deviceAuthorizations.id, id),
        eq(deviceAuthorizations.status, "pending"),
        sql`${deviceAuthorizations.expiresAt} > now()`,
      ),
    )
    .returning({ id: deviceAuthorizations.id });
  return rows.length > 0;
}

/** トークンを渡した印を付ける（approved で期限内のときだけ）。できたらデバイス ID を返す */
export async function markConsumed(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db
    .update(deviceAuthorizations)
    .set({ status: "consumed" })
    .where(
      and(
        eq(deviceAuthorizations.id, id),
        eq(deviceAuthorizations.status, "approved"),
        sql`${deviceAuthorizations.expiresAt} > now()`,
      ),
    )
    .returning({ deviceId: deviceAuthorizations.deviceId });
  return row?.deviceId ?? undefined;
}

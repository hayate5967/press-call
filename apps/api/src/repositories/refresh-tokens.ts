// リフレッシュトークンの DB アクセス（ハッシュだけを扱う。平文はここに来ない）
//
// 時刻の比較（期限・猶予時間）はすべて DB の now() で行う。
// Worker と DB の時計がずれていても、判定がぶれないようにするため
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { refreshTokens } from "../db/schema";

/** リフレッシュトークンの寿命（ADR-0005） */
export const REFRESH_TOKEN_TTL = "30 days";

/** 使用済みのトークンが再び来ても、盗難とみなさない猶予（2 つのタブからの同時更新。ADR-0005） */
export const REUSE_GRACE = "10 seconds";

export async function insertRefreshToken(
  db: Db,
  input: { userId: string; familyId: string; tokenHash: string },
): Promise<void> {
  await db.insert(refreshTokens).values({
    ...input,
    expiresAt: sql`now() + ${REFRESH_TOKEN_TTL}::interval`,
  });
}

/**
 * 有効で未使用のトークンを「使用済み」にする。できたら持ち主と系統を返す。
 * 条件付きの UPDATE 1 文なので、同じトークンで同時に呼ばれても成功するのは 1 回だけ
 */
export async function markRefreshTokenUsed(
  db: Db,
  tokenHash: string,
): Promise<{ userId: string; familyId: string } | undefined> {
  const [row] = await db
    .update(refreshTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.usedAt),
        isNull(refreshTokens.revokedAt),
        sql`${refreshTokens.expiresAt} > now()`,
      ),
    )
    .returning({ userId: refreshTokens.userId, familyId: refreshTokens.familyId });
  return row;
}

export type RefreshTokenState = {
  userId: string;
  familyId: string;
  revoked: boolean;
  expired: boolean;
  used: boolean;
  /** 使用済みになってから猶予時間（10 秒）以内か */
  usedWithinGrace: boolean;
};

/** トークンの状態を調べる（markRefreshTokenUsed で使えなかった理由を分けるため） */
export async function findRefreshTokenState(
  db: Db,
  tokenHash: string,
): Promise<RefreshTokenState | undefined> {
  const [row] = await db
    .select({
      userId: refreshTokens.userId,
      familyId: refreshTokens.familyId,
      revoked: sql<boolean>`${refreshTokens.revokedAt} is not null`,
      expired: sql<boolean>`${refreshTokens.expiresAt} <= now()`,
      used: sql<boolean>`${refreshTokens.usedAt} is not null`,
      usedWithinGrace: sql<boolean>`coalesce(${refreshTokens.usedAt} > now() - ${REUSE_GRACE}::interval, false)`,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));
  return row;
}

/** 系統（同じログインから交換され続けたトークン）をすべて失効させる */
export async function revokeRefreshTokenFamily(db: Db, familyId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

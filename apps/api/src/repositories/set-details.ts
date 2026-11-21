// セットの詳細を読む DB アクセス（Web アプリ向け）。持ち主の userId で絞り、削除したセットは返さない
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { reps, setRawData, sets, trainingSessions } from "../db/schema";

/**
 * セット 1 件（使った設定・生データの有無つき）。
 * 他人のセット・存在しないセット・削除したセットは undefined
 */
export async function findOwnedSet(db: Db, userId: string, setId: string) {
  const [row] = await db
    .select({
      id: sets.id,
      sessionId: sets.sessionId,
      startedAt: sets.startedAt,
      endedAt: sets.endedAt,
      mode: sets.mode,
      pauseMode: sets.pauseMode,
      pauseFixedMs: sets.pauseFixedMs,
      pauseMinMs: sets.pauseMinMs,
      pauseMaxMs: sets.pauseMaxMs,
      weightKg: sets.weightKg,
      rpe: sets.rpe,
      note: sets.note,
      // 生データの本体（最大 256KB）は読まず、あるかどうかだけ調べる
      hasRawData: sql<boolean>`exists (
        select 1 from ${setRawData} r where r.set_id = "sets"."id"
      )`,
    })
    .from(sets)
    .innerJoin(trainingSessions, eq(trainingSessions.id, sets.sessionId))
    .where(and(eq(sets.id, setId), eq(trainingSessions.userId, userId), isNull(sets.deletedAt)));
  return row;
}

/** セットのレップ（全項目）。1 レップ目から */
export async function listRepDetails(db: Db, setId: string) {
  return db
    .select({
      index: reps.repIndex,
      startOffsetMs: reps.startOffsetMs,
      eccentricMs: reps.eccentricMs,
      pauseTargetMs: reps.pauseTargetMs,
      pauseActualMs: reps.pauseActualMs,
      reactionMs: reps.reactionMs,
      isPremature: reps.isPremature,
      concentricMs: reps.concentricMs,
      meanVelocityMps: reps.meanVelocityMps,
      peakVelocityMps: reps.peakVelocityMps,
      curveHz: reps.curveHz,
      velocityCurve: reps.velocityCurve,
    })
    .from(reps)
    .where(eq(reps.setId, setId))
    .orderBy(asc(reps.repIndex));
}

export type SetPatch = { weightKg?: number | null; rpe?: number | null; note?: string | null };

/**
 * 持ち主の削除していないセットの重量・RPE・メモを変える（渡した項目だけ）。
 * 変えたら true。他人のセット・存在しないセット・削除したセットは false
 */
export async function updateOwnedSet(
  db: Db,
  userId: string,
  setId: string,
  patch: SetPatch,
): Promise<boolean> {
  const rows = await db
    .update(sets)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(sets.id, setId), isNull(sets.deletedAt), ownedBy(userId)))
    .returning({ id: sets.id });
  return rows.length > 0;
}

/**
 * セットを削除する。行は残して deleted_at を入れ（同じ clientSetId の再送で復活させないため）、
 * レップと生データは消す（data-design.md の sets.deleted_at）。
 * 消したら true。他人のセット・存在しないセット・削除済みのセットは false
 */
export async function softDeleteOwnedSet(db: Db, userId: string, setId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(sets)
      .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(sets.id, setId), isNull(sets.deletedAt), ownedBy(userId)))
      .returning({ id: sets.id });
    if (rows.length === 0) return false;
    await tx.delete(reps).where(eq(reps.setId, setId));
    await tx.delete(setRawData).where(eq(setRawData.setId, setId));
    return true;
  });
}

/**
 * セットの練習日が、そのユーザーのものか（UPDATE の WHERE 用。sets には user_id がないので練習日から見る）。
 * 副問い合わせの中の id は training_sessions の id（内側の表が優先される）
 */
function ownedBy(userId: string) {
  return sql`${sets.sessionId} in (
    select ts.id from ${trainingSessions} ts where ts.user_id = ${userId}
  )`;
}

/**
 * 次の問い合わせの基準にする時刻（DB の時計）。
 * セットの created_at は登録のトランザクションを始めた時刻なので、この問い合わせの時点でまだ確定していない
 * セットもありうる。少し前にずらしておき、次の問い合わせでそれも拾えるようにする（重なった分は画面が ID で除く）
 */
export const NEW_SETS_OVERLAP = "5 seconds";

export async function serverTimeForNextPoll(db: Db): Promise<Date> {
  const result = (await db.execute(
    sql`select clock_timestamp() - ${NEW_SETS_OVERLAP}::interval as t`,
  )) as unknown as { rows: { t: Date | string }[] }; // node-postgres も PGlite も { rows } を返す
  const t = result.rows[0]?.t;
  if (t === undefined) throw new Error("DB の時刻を取れませんでした");
  return new Date(t);
}

/** createdAfter より後に届いた、持ち主の削除していないセット（届いた順、最大 limit 件） */
export async function listSetsCreatedAfter(
  db: Db,
  userId: string,
  createdAfter: Date,
  limit: number,
) {
  return db
    .select({
      id: sets.id,
      sessionId: sets.sessionId,
      startedAt: sets.startedAt,
      mode: sets.mode,
      weightKg: sets.weightKg,
      repCount: sql<number>`(select count(*)::int from ${reps} r where r.set_id = "sets"."id")`,
    })
    .from(sets)
    .innerJoin(trainingSessions, eq(trainingSessions.id, sets.sessionId))
    .where(
      and(
        eq(trainingSessions.userId, userId),
        isNull(sets.deletedAt),
        gt(sets.createdAt, createdAfter),
      ),
    )
    .orderBy(asc(sets.createdAt), asc(sets.id))
    .limit(limit);
}

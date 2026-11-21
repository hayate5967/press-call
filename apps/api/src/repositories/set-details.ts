// セットの詳細を読む DB アクセス（Web アプリ向け）。持ち主の userId で絞り、削除したセットは返さない
import { and, asc, eq, isNull, sql } from "drizzle-orm";
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

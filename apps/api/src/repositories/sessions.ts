// 練習日（training_sessions）と、その日のセット・レップを読む DB アクセス（Web アプリ向け）
// どの関数も持ち主の userId で絞る。削除したセット（deleted_at あり）は数えない・返さない
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { reps, sets, trainingSessions } from "../db/schema";

export type SessionSummaryRow = {
  id: string;
  date: string;
  setCount: number;
  repCount: number;
};

/**
 * 練習日の一覧（日付の新しい順）。削除していないセットが 1 つもない日は出さない（API 仕様書 6 章）。
 * before を渡すと、その日付より前だけを返す（カーソル）。続きがあるか調べるため limit + 1 件まで読む
 */
export async function listSessionSummaries(
  db: Db,
  userId: string,
  opts: { before: string | null; take: number },
): Promise<SessionSummaryRow[]> {
  return (
    db
      .select({
        id: trainingSessions.id,
        date: trainingSessions.sessionDate,
        // レップを結合すると 1 セットが複数行になるので、セットは重複を除いて数える
        setCount: sql<number>`count(distinct ${sets.id})::int`,
        repCount: sql<number>`count(${reps.id})::int`,
      })
      .from(trainingSessions)
      // 内部結合なので、削除していないセットがない練習日は結果に出ない
      .innerJoin(sets, and(eq(sets.sessionId, trainingSessions.id), isNull(sets.deletedAt)))
      .leftJoin(reps, eq(reps.setId, sets.id))
      .where(
        and(
          eq(trainingSessions.userId, userId),
          opts.before ? lt(trainingSessions.sessionDate, opts.before) : undefined,
        ),
      )
      .groupBy(trainingSessions.id)
      .orderBy(desc(trainingSessions.sessionDate))
      .limit(opts.take)
  );
}

export type SessionSetRow = {
  id: string;
  date: string;
  startedAt: Date;
  mode: "auto_signal" | "count_only";
  weightKg: number | null;
  rpe: number | null;
  note: string | null;
};

/**
 * 練習日のセット（挙げた順）。他人の練習日・存在しない練習日・セットがすべて削除された練習日は空になる
 */
export async function listSessionSets(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<SessionSetRow[]> {
  return db
    .select({
      id: sets.id,
      date: trainingSessions.sessionDate,
      startedAt: sets.startedAt,
      mode: sets.mode,
      weightKg: sets.weightKg,
      rpe: sets.rpe,
      note: sets.note,
    })
    .from(sets)
    .innerJoin(trainingSessions, eq(trainingSessions.id, sets.sessionId))
    .where(
      and(
        eq(trainingSessions.id, sessionId),
        eq(trainingSessions.userId, userId),
        isNull(sets.deletedAt),
      ),
    )
    .orderBy(asc(sets.startedAt), asc(sets.id));
}

export type RepSummaryRow = {
  setId: string;
  index: number;
  meanVelocityMps: number | null;
  peakVelocityMps: number | null;
  isPremature: boolean;
  pauseActualMs: number | null;
  reactionMs: number | null;
};

/** セットのレップ（速度カーブは重いので読まない）。セットごと・レップの順 */
export async function listRepSummaries(db: Db, setIds: string[]): Promise<RepSummaryRow[]> {
  if (setIds.length === 0) return [];
  return db
    .select({
      setId: reps.setId,
      index: reps.repIndex,
      meanVelocityMps: reps.meanVelocityMps,
      peakVelocityMps: reps.peakVelocityMps,
      isPremature: reps.isPremature,
      pauseActualMs: reps.pauseActualMs,
      reactionMs: reps.reactionMs,
    })
    .from(reps)
    .where(inArray(reps.setId, setIds))
    .orderBy(asc(reps.setId), asc(reps.repIndex));
}

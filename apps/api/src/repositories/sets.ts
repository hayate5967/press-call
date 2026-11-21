// セット・レップ・練習日の DB アクセス
import type { Pause, RepInput } from "@press-call/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { pauseColumns } from "../db/pause";
import { reps, sets, trainingSessions } from "../db/schema";

export type SetKey = { setId: string; sessionId: string };

/** 同じデバイスから届いた同じ clientSetId のセットを探す（削除済みも含む） */
export async function findSetByClientSetId(
  db: Db,
  deviceId: string,
  clientSetId: string,
): Promise<SetKey | undefined> {
  const [row] = await db
    .select({ setId: sets.id, sessionId: sets.sessionId })
    .from(sets)
    .where(and(eq(sets.deviceId, deviceId), eq(sets.clientSetId, clientSetId)));
  return row;
}

/** その日の練習日を返す。なければ作る */
export async function getOrCreateSession(
  db: Db,
  userId: string,
  sessionDate: string,
): Promise<string> {
  // 同時に 2 つ届いても UNIQUE 制約で 1 行にしかならない。作れなかったら既存の行を読む
  const [inserted] = await db
    .insert(trainingSessions)
    .values({ userId, sessionDate })
    .onConflictDoNothing({ target: [trainingSessions.userId, trainingSessions.sessionDate] })
    .returning({ id: trainingSessions.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: trainingSessions.id })
    .from(trainingSessions)
    .where(and(eq(trainingSessions.userId, userId), eq(trainingSessions.sessionDate, sessionDate)));
  if (!existing) throw new Error("練習日の作成に失敗しました");
  return existing.id;
}

export type NewSet = {
  sessionId: string;
  deviceId: string;
  clientSetId: string;
  mode: "auto_signal" | "count_only";
  pause: Pause | null;
  /** ISO 8601 の文字列（API の入力のまま）。DB には Date にして入れる */
  startedAt: string;
  endedAt: string;
};

/**
 * セットを登録する。同じ (deviceId, clientSetId) がすでにあれば何もせず undefined を返す。
 * 「先に探してから入れる」の間に別のリクエストが入っても、UNIQUE 制約で二重にならない
 */
export async function insertSetIfAbsent(db: Db, s: NewSet): Promise<string | undefined> {
  const [row] = await db
    .insert(sets)
    .values({
      sessionId: s.sessionId,
      deviceId: s.deviceId,
      clientSetId: s.clientSetId,
      mode: s.mode,
      ...pauseColumns(s.pause),
      startedAt: new Date(s.startedAt),
      endedAt: new Date(s.endedAt),
    })
    .onConflictDoNothing({ target: [sets.deviceId, sets.clientSetId] })
    .returning({ id: sets.id });
  return row?.id;
}

export async function insertReps(db: Db, setId: string, input: RepInput[]): Promise<void> {
  if (input.length === 0) return;
  await db.insert(reps).values(
    input.map((r) => ({
      setId,
      repIndex: r.index,
      startOffsetMs: r.startOffsetMs,
      eccentricMs: r.eccentricMs,
      pauseTargetMs: r.pauseTargetMs,
      pauseActualMs: r.pauseActualMs,
      reactionMs: r.reactionMs,
      isPremature: r.isPremature,
      concentricMs: r.concentricMs,
      meanVelocityMps: toReal(r.meanVelocityMps),
      peakVelocityMps: toReal(r.peakVelocityMps),
      curveHz: r.curveHz,
      velocityCurve: r.velocityCurve?.map((v) => Math.fround(v)) ?? null,
    })),
  );
}

/**
 * real 列に入れる前に 32 ビットの精度に丸める。
 * PostgreSQL は 1e-50 のように real で表せないほど 0 に近い値をエラーにするため、先に 0 にしておく
 * （どのみち real に保存すると、この精度に丸められる）
 */
function toReal(v: number | null): number | null {
  return v === null ? null : Math.fround(v);
}

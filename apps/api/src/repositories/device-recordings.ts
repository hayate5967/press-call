// セットの開始・終了の指示（device_recordings）の DB アクセス（ADR-0011）
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { deviceRecordings } from "../db/schema";

export type RecordingRow = typeof deviceRecordings.$inferSelect;

export async function findRecording(db: Db, deviceId: string): Promise<RecordingRow | undefined> {
  const [row] = await db
    .select()
    .from(deviceRecordings)
    .where(eq(deviceRecordings.deviceId, deviceId));
  return row;
}

/**
 * 開始・終了を切り替える。今と違う状態のときだけ seq を 1 増やし、開始なら started_at、
 * 終了なら stopped_at に今の時刻を入れる。今と同じ状態なら何も変えない（二度押しで番号が進まない）。
 * 行がなければ作る（行がない＝停止中なので、作るのは開始のときだけ）
 */
export async function switchRecording(db: Db, deviceId: string, recording: boolean): Promise<void> {
  await db
    .insert(deviceRecordings)
    .values({
      deviceId,
      recording,
      seq: 1,
      startedAt: recording ? sql`now()` : null,
      stoppedAt: recording ? null : sql`now()`,
    })
    .onConflictDoUpdate({
      target: deviceRecordings.deviceId,
      set: {
        recording,
        seq: sql`${deviceRecordings.seq} + 1`,
        ...(recording ? { startedAt: sql`now()` } : { stoppedAt: sql`now()` }),
        updatedAt: sql`now()`,
      },
      setWhere: ne(deviceRecordings.recording, recording),
    });
}

/** ESP32 が今の番号を受け取ったことを記録する（変わったときだけ書く） */
export async function ackRecording(db: Db, deviceId: string): Promise<void> {
  await db
    .update(deviceRecordings)
    .set({ ackedSeq: sql`${deviceRecordings.seq}` })
    .where(
      and(
        eq(deviceRecordings.deviceId, deviceId),
        ne(deviceRecordings.ackedSeq, deviceRecordings.seq),
      ),
    );
}

/**
 * ESP32 が自分でセットを終えた（記録中に一定時間動きがなかった）。
 * 番号が今と同じで記録中のときだけ停止にする（seq は増やさない）。その間に別の指示が出ていれば何もしない
 */
export async function stopRecordingByDevice(db: Db, deviceId: string, seq: number): Promise<void> {
  await db
    .update(deviceRecordings)
    .set({ recording: false, stoppedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(deviceRecordings.deviceId, deviceId),
        eq(deviceRecordings.seq, seq),
        eq(deviceRecordings.recording, true),
      ),
    );
}

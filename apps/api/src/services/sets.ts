// セット登録の業務ルール：冪等な登録と、練習日（同じ日のセットのまとまり）の自動作成
import type { CreateSetInput, CreateSetResult } from "@press-call/shared";
import type { Db } from "../db/client";
import {
  findSetByClientSetId,
  getOrCreateSession,
  insertReps,
  insertSetIfAbsent,
} from "../repositories/sets";

/** セットを送ってきたデバイスと、その持ち主 */
export type DeviceContext = { deviceId: string; userId: string };

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * セットの開始時刻（UTC）から練習日（日本時間の日付）を求める。
 * 例：2026-11-15T15:30:00Z は日本時間で 11/16 0:30 なので "2026-11-16"
 */
export function toSessionDate(startedAt: string): string {
  return new Date(Date.parse(startedAt) + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * セットとレップを登録する。
 * - 同じ clientSetId がもう届いていれば、何も変えずに既存のセットを返す（created: false）
 * - 削除済みのセットでも復活させず、既存として扱う（data-design.md の deleted_at の理由）
 * - 練習日・セット・レップは 1 つのトランザクションで入れ、「セットだけあってレップがない」状態を作らない
 */
export async function registerSet(
  db: Db,
  device: DeviceContext,
  input: CreateSetInput,
): Promise<CreateSetResult> {
  return db.transaction(async (tx) => {
    const existing = await findSetByClientSetId(tx, device.deviceId, input.clientSetId);
    if (existing) return { ...existing, created: false };

    const sessionId = await getOrCreateSession(tx, device.userId, toSessionDate(input.startedAt));
    const setId = await insertSetIfAbsent(tx, {
      sessionId,
      deviceId: device.deviceId,
      clientSetId: input.clientSetId,
      mode: input.mode,
      pause: input.pause,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    });

    if (!setId) {
      // 探したあとに、同時に届いた同じセットが先に登録された
      const raced = await findSetByClientSetId(tx, device.deviceId, input.clientSetId);
      if (!raced) throw new Error("セットの登録に失敗しました");
      return { ...raced, created: false };
    }

    await insertReps(tx, setId, input.reps);
    return { setId, sessionId, created: true };
  });
}

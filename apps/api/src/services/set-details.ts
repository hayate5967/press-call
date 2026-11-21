// セットの詳細（API 仕様書 6 章、FR-V02・V08）
import type { SetDetail } from "@press-call/shared";
import type { Db } from "../db/client";
import { pauseFromColumns } from "../db/pause";
import { ApiError } from "../middleware/error";
import { findOwnedSet, listRepDetails } from "../repositories/set-details";

/** セットの詳細。他人のセット・存在しないセット・削除したセットは 404（存在を漏らさない） */
export async function getSetDetail(db: Db, userId: string, setId: string): Promise<SetDetail> {
  const set = await findOwnedSet(db, userId, setId);
  if (!set) throw new ApiError(404, "not_found", "見つかりません");
  const repRows = await listRepDetails(db, setId);
  return {
    id: set.id,
    sessionId: set.sessionId,
    startedAt: set.startedAt.toISOString(),
    endedAt: set.endedAt.toISOString(),
    mode: set.mode,
    pause: pauseFromColumns(set),
    weightKg: set.weightKg,
    rpe: set.rpe,
    note: set.note,
    hasRawData: set.hasRawData,
    repCount: repRows.length,
    reps: repRows,
  };
}

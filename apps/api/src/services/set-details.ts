// セットの詳細（API 仕様書 6 章、FR-V02・V08）
import type { SetDetail, UpdateSetInput } from "@press-call/shared";
import type { Db } from "../db/client";
import { pauseFromColumns } from "../db/pause";
import { ApiError } from "../middleware/error";
import {
  findOwnedSet,
  listRepDetails,
  type SetPatch,
  softDeleteOwnedSet,
  updateOwnedSet,
} from "../repositories/set-details";

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

/**
 * 重量・RPE・メモを変える（PATCH /sets/{id}）。送った項目だけ変わり、null なら空に戻す。
 * 変えたあとのセットの詳細を返す
 */
export async function patchSet(
  db: Db,
  userId: string,
  setId: string,
  input: UpdateSetInput,
): Promise<SetDetail> {
  // undefined（送っていない項目）は渡さない。null は「空に戻す」なのでそのまま渡す
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as SetPatch;
  if (!(await updateOwnedSet(db, userId, setId, patch))) {
    throw new ApiError(404, "not_found", "見つかりません");
  }
  return getSetDetail(db, userId, setId);
}

/** セットを削除する（DELETE /sets/{id}）。他人のセット・存在しないセット・削除済みのセットは 404 */
export async function deleteSet(db: Db, userId: string, setId: string): Promise<void> {
  if (!(await softDeleteOwnedSet(db, userId, setId))) {
    throw new ApiError(404, "not_found", "見つかりません");
  }
}

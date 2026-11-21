// 練習日の一覧と詳細（API 仕様書 6 章、FR-V01）
import type { SessionDetail, SessionList } from "@press-call/shared";
import type { Db } from "../db/client";
import { ApiError } from "../middleware/error";
import {
  listRepSummaries,
  listSessionSets,
  listSessionSummaries,
  type RepSummaryRow,
} from "../repositories/sessions";

/*
 * カーソルは「そのページの最後の練習日の日付」を JSON にして base64url にしたもの（例 {"d":"2026-11-10"}）。
 * 練習日は (user_id, session_date) で 1 行なので、日付だけで次のページの位置が決まる。
 * 中身に意味を持たせない約束（画面はそのまま送り返すだけ）にしておき、あとで形を変えられるようにする
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function encodeCursor(date: string): string {
  return btoa(JSON.stringify({ d: date }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** カーソルから日付を取り出す。形が違えば null */
export function decodeCursor(cursor: string): string | null {
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(base64));
    if (typeof parsed !== "object" || parsed === null || !("d" in parsed)) return null;
    const d = parsed.d;
    return typeof d === "string" && DATE_RE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null;
  } catch {
    return null;
  }
}

/** 練習日の一覧（新しい順）。cursor は前のページの nextCursor（入力チェック済み） */
export async function listSessions(
  db: Db,
  userId: string,
  opts: { limit: number; cursor: string | undefined },
): Promise<SessionList> {
  const before = opts.cursor === undefined ? null : decodeCursor(opts.cursor);
  const rows = await listSessionSummaries(db, userId, { before, take: opts.limit + 1 });
  const items = rows.slice(0, opts.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.date) : null,
  };
}

/**
 * 練習日のセットと各レップの速度。
 * 他人の練習日・存在しない練習日は 404（存在を漏らさない）。
 * セットがすべて削除された練習日も、一覧に出さないのに合わせて 404 にする
 */
export async function getSessionDetail(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<SessionDetail> {
  const setRows = await listSessionSets(db, userId, sessionId);
  const first = setRows[0];
  if (!first) throw new ApiError(404, "not_found", "見つかりません");

  const repsBySet = new Map<string, RepSummaryRow[]>();
  for (const r of await listRepSummaries(
    db,
    setRows.map((s) => s.id),
  )) {
    const list = repsBySet.get(r.setId) ?? [];
    list.push(r);
    repsBySet.set(r.setId, list);
  }

  return {
    id: sessionId,
    date: first.date,
    sets: setRows.map((s) => {
      const repRows = repsBySet.get(s.id) ?? [];
      return {
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        mode: s.mode,
        weightKg: s.weightKg,
        rpe: s.rpe,
        note: s.note,
        repCount: repRows.length,
        reps: repRows.map(({ setId: _setId, ...rep }) => rep),
      };
    }),
  };
}

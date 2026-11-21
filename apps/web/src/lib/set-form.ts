// セットの記録（重量・RPE・メモ）のフォームの値 ⇔ API の形（PATCH /sets/{id}）の変換
import { type SetDetail, type UpdateSetInput, updateSetInputSchema } from "@press-call/shared";

export type SetForm = {
  /** kg（文字列のまま持つ。入力途中の "100." などを壊さないため）。空なら未入力 */
  weight: string;
  /** 未入力なら null */
  rpe: number | null;
  note: string;
};

export function toSetForm(set: Pick<SetDetail, "weightKg" | "rpe" | "note">): SetForm {
  return {
    weight: set.weightKg === null ? "" : String(set.weightKg),
    rpe: set.rpe,
    note: set.note ?? "",
  };
}

/** 全角の数字や小数点（「１００．５」）も受け付ける。空なら null、数でなければ NaN */
export function parseWeight(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。，,]/g, ".");
  if (normalized === "") return null;
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

export type SetFormResult =
  | { ok: true; input: Required<UpdateSetInput> }
  | { ok: false; errors: Partial<Record<keyof SetForm, string>> };

/** フォームの値を API の形にし、API と同じルール（shared の Zod スキーマ）で確かめる */
export function fromSetForm(f: SetForm): SetFormResult {
  const weightKg = parseWeight(f.weight);
  const note = f.note.trim() === "" ? null : f.note.trim();
  if (Number.isNaN(weightKg)) {
    return { ok: false, errors: { weight: "数字で入力してください（例：100 や 102.5）" } };
  }
  const result = updateSetInputSchema.safeParse({ weightKg, rpe: f.rpe, note });
  if (result.success) return { ok: true, input: { weightKg, rpe: f.rpe, note } };

  const errors: Partial<Record<keyof SetForm, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key === "weightKg") errors.weight ??= "0〜500 kg、0.5 kg 刻みで入力してください";
    else if (key === "rpe") errors.rpe ??= "RPE は 1〜10、0.5 刻みです";
    else if (key === "note") errors.note ??= "メモは 500 文字までです";
  }
  return { ok: false, errors };
}

/** 保存した値から変わったか（変わっていなければ保存ボタンを押せなくする） */
export function isSetFormChanged(saved: SetForm, current: SetForm): boolean {
  return (
    parseWeight(saved.weight) !== parseWeight(current.weight) ||
    saved.rpe !== current.rpe ||
    saved.note.trim() !== current.note.trim()
  );
}

/** RPE のボタン（よく使う 6〜10 を 0.5 刻み）。保存済みの値がこれ以外なら、その値も足す */
export function rpeChoices(current: number | null): number[] {
  const base = Array.from({ length: 9 }, (_, i) => 6 + i * 0.5);
  return current === null || base.includes(current)
    ? base
    : [...base, current].sort((a, b) => a - b);
}

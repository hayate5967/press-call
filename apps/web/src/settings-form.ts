// 設定画面のフォームの値 ⇔ API の形（PUT /devices/{id}/settings）の変換
// 画面では待ち時間を「秒」で入力し、API には「ミリ秒」で送る
import {
  type DeviceSettings,
  type DeviceSettingsInput,
  deviceSettingsInputSchema,
} from "@press-call/shared";

export type SettingsForm = {
  mode: "auto_signal" | "count_only";
  pauseMode: "fixed" | "random";
  /** 秒（文字列のまま持つ。入力途中の "1." などを壊さないため） */
  fixedSec: string;
  minSec: string;
  maxSec: string;
  /** 空ならファームの既定値 */
  stillThreshold: string;
};

const sec = (ms: number) => String(ms / 1000);

export function toForm(s: DeviceSettings): SettingsForm {
  const pause = s.pause;
  return {
    mode: s.mode,
    pauseMode: pause?.mode ?? "fixed",
    fixedSec: pause?.mode === "fixed" ? sec(pause.fixedMs) : "1",
    minSec: pause?.mode === "random" ? sec(pause.minMs) : "0.5",
    maxSec: pause?.mode === "random" ? sec(pause.maxMs) : "1.5",
    stillThreshold: s.stillThreshold === null ? "" : String(s.stillThreshold),
  };
}

/** 秒の文字列をミリ秒に。数でなければ NaN（入力チェックで弾かれる） */
function ms(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Math.round(Number(value) * 1000);
}

export type FormResult =
  | { ok: true; input: DeviceSettingsInput }
  | { ok: false; errors: Partial<Record<keyof SettingsForm, string>> };

/** フォームの値を API の形にし、API と同じルール（shared の Zod スキーマ）で確かめる */
export function fromForm(f: SettingsForm): FormResult {
  const pause =
    f.mode === "count_only"
      ? null
      : f.pauseMode === "fixed"
        ? { mode: "fixed" as const, fixedMs: ms(f.fixedSec) }
        : { mode: "random" as const, minMs: ms(f.minSec), maxMs: ms(f.maxSec) };
  const stillThreshold = f.stillThreshold.trim() === "" ? null : Number(f.stillThreshold);

  const result = deviceSettingsInputSchema.safeParse({ mode: f.mode, pause, stillThreshold });
  if (result.success) return { ok: true, input: result.data };

  const errors: Partial<Record<keyof SettingsForm, string>> = {};
  for (const issue of result.error.issues) {
    const field = fieldOf(issue.path.map(String));
    errors[field] ??= messageFor(field);
  }
  return { ok: false, errors };
}

function fieldOf(path: string[]): keyof SettingsForm {
  const last = path.at(-1);
  if (path[0] === "stillThreshold") return "stillThreshold";
  if (last === "fixedMs") return "fixedSec";
  if (last === "minMs") return "minSec";
  if (last === "maxMs") return "maxSec";
  return "mode";
}

function messageFor(field: keyof SettingsForm): string {
  switch (field) {
    case "fixedSec":
    case "maxSec":
      return "0.2〜5 秒で入力してください";
    case "minSec":
      return "0.2〜5 秒で、最大以下にしてください";
    case "stillThreshold":
      return "空欄（既定値）か、0 より大きく 0.15 未満の数にしてください";
    default:
      return "入力を確認してください";
  }
}

/** 合図の設定を 1 行で（「自動合図・固定 1.0 秒」「自動合図・ランダム 0.5〜1.5 秒」「回数記録（合図なし）」） */
export function settingsSummary(s: Pick<DeviceSettings, "mode" | "pause">): string {
  if (s.mode === "count_only" || s.pause === null) return "回数記録（合図なし）";
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  return s.pause.mode === "fixed"
    ? `自動合図・固定 ${sec(s.pause.fixedMs)} 秒`
    : `自動合図・ランダム ${sec(s.pause.minMs)}〜${sec(s.pause.maxMs)} 秒`;
}

/** 秒の入力欄を「− / ＋」で動かす（0.2〜5 秒の範囲に収め、小数 1 桁にそろえる）。数でなければ 1 秒から */
export function stepSeconds(value: string, delta: number): string {
  const current = Number(value);
  const base = value.trim() === "" || Number.isNaN(current) ? 1 : current;
  const next = Math.min(5, Math.max(0.2, Math.round((base + delta) * 10) / 10));
  return next.toFixed(1);
}

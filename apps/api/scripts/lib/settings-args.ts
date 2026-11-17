// pnpm device:settings の引数（秒で指定）を、API と同じ設定の形（ミリ秒）にする
import {
  type DeviceSettingsInput,
  deviceSettingsInputSchema,
  STILL_THRESHOLD_MAX_MPS,
} from "@press-call/shared";

export type SettingsArgs = {
  fixed?: string; // 例："1.0"（秒）
  random?: string; // 例："0.5-1.5"（秒）
  countOnly?: boolean;
  still?: string; // 例："0.06"（m/s）
};

export type ParseResult = { ok: true; input: DeviceSettingsInput } | { ok: false; error: string };

/** "1.5" のような秒の文字列をミリ秒にする。数でなければ undefined */
function secondsToMs(text: string): number | undefined {
  if (!/^\d+(\.\d+)?$/.test(text.trim())) return undefined;
  return Math.round(Number(text) * 1000);
}

export function parseSettingsArgs(args: SettingsArgs): ParseResult {
  const chosen = [args.fixed !== undefined, args.random !== undefined, args.countOnly === true];
  if (chosen.filter(Boolean).length !== 1) {
    return { ok: false, error: "--fixed・--random・--count-only のどれか 1 つを指定してください" };
  }

  let stillThreshold: number | null = null;
  if (args.still !== undefined) {
    const v = Number(args.still);
    if (!/^\d+(\.\d+)?$/.test(args.still.trim()) || !(v > 0)) {
      return { ok: false, error: `--still は正の数（m/s）で指定してください（${args.still}）` };
    }
    stillThreshold = v;
  }

  let candidate: unknown;
  if (args.countOnly) {
    candidate = { mode: "count_only", pause: null, stillThreshold };
  } else if (args.fixed !== undefined) {
    const fixedMs = secondsToMs(args.fixed);
    if (fixedMs === undefined) {
      return { ok: false, error: `--fixed は秒で指定してください（例：1.0）（${args.fixed}）` };
    }
    candidate = { mode: "auto_signal", pause: { mode: "fixed", fixedMs }, stillThreshold };
  } else {
    const parts = (args.random ?? "").split("-");
    const minMs = parts.length === 2 ? secondsToMs(parts[0] ?? "") : undefined;
    const maxMs = parts.length === 2 ? secondsToMs(parts[1] ?? "") : undefined;
    if (minMs === undefined || maxMs === undefined) {
      return {
        ok: false,
        error: `--random は「最小-最大」の秒で指定してください（例：0.5-1.5）（${args.random}）`,
      };
    }
    candidate = { mode: "auto_signal", pause: { mode: "random", minMs, maxMs }, stillThreshold };
  }

  // API の PUT と同じルール（待ち時間は 200〜5000ms で min ≦ max、しきい値は 0 より大きく上限未満）で確かめる
  const parsed = deviceSettingsInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    let detail = issue?.message ?? "設定が正しくありません";
    if (issue?.path[0] === "stillThreshold") {
      detail = `--still は 0 より大きく ${STILL_THRESHOLD_MAX_MPS} 未満（m/s）で指定してください`;
    } else if (issue?.code === "too_small" || issue?.code === "too_big") {
      detail = "待ち時間は 0.2〜5.0 秒の範囲で指定してください";
    }
    return { ok: false, error: detail };
  }
  return { ok: true, input: parsed.data };
}

/** 設定を人が読める形にする（例：自動合図・ランダム 0.5〜1.5 秒） */
export function describeSettings(s: DeviceSettingsInput & { version?: number }): string {
  const sec = (ms: number) => (ms / 1000).toFixed(1);
  let text: string;
  if (s.mode === "count_only" || s.pause === null) {
    text = "回数記録（合図なし）";
  } else if (s.pause.mode === "fixed") {
    text = `自動合図・固定 ${sec(s.pause.fixedMs)} 秒`;
  } else {
    text = `自動合図・ランダム ${sec(s.pause.minMs)}〜${sec(s.pause.maxMs)} 秒`;
  }
  const still = s.stillThreshold === null ? "既定値" : `${s.stillThreshold} m/s`;
  const version = s.version === undefined ? "" : `（version ${s.version}）`;
  return `${text}、静止のしきい値: ${still}${version}`;
}

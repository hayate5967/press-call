// 待ち時間の設定（API の pause）と DB の列（pause_mode・pause_fixed_ms・pause_min_ms・pause_max_ms）の変換。
// device_settings と sets で同じ列の組を使う（schema.ts の pauseConsistency）
import type { Pause } from "@press-call/shared";

export type PauseColumns = {
  pauseMode: "fixed" | "random" | null;
  pauseFixedMs: number | null;
  pauseMinMs: number | null;
  pauseMaxMs: number | null;
};

/** API の pause（入れ子の形）を DB の列に分ける */
export function pauseColumns(pause: Pause | null): PauseColumns {
  if (pause === null) {
    return { pauseMode: null, pauseFixedMs: null, pauseMinMs: null, pauseMaxMs: null };
  }
  return pause.mode === "fixed"
    ? { pauseMode: "fixed", pauseFixedMs: pause.fixedMs, pauseMinMs: null, pauseMaxMs: null }
    : { pauseMode: "random", pauseFixedMs: null, pauseMinMs: pause.minMs, pauseMaxMs: pause.maxMs };
}

/** DB の列を API の pause に戻す。回数記録モード（列がすべて空）なら null */
export function pauseFromColumns(c: PauseColumns): Pause | null {
  if (c.pauseMode === "fixed" && c.pauseFixedMs !== null) {
    return { mode: "fixed", fixedMs: c.pauseFixedMs };
  }
  if (c.pauseMode === "random" && c.pauseMinMs !== null && c.pauseMaxMs !== null) {
    return { mode: "random", minMs: c.pauseMinMs, maxMs: c.pauseMaxMs };
  }
  // DB の CHECK 制約で、ほかの組み合わせは入らない
  return null;
}

// セットの詳細画面で使う計算と書式（画面から切り離してテストする）
import type { Pause, RepDetail } from "@press-call/shared";

export type CurvePoint = { t: number; v: number };

/** 速度カーブを「挙げ始めからの時間（ミリ秒）と速度」の点の列にする。カーブがなければ空 */
export function curvePoints(rep: Pick<RepDetail, "curveHz" | "velocityCurve">): CurvePoint[] {
  const { curveHz, velocityCurve } = rep;
  if (!curveHz || !velocityCurve) return [];
  return velocityCurve.map((v, i) => ({ t: Math.round((i * 1000) / curveHz), v }));
}

/** ミリ秒を「1.20 秒」にする。値がなければ「—」 */
export function formatSeconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(2)} 秒`;
}

/** 待ち時間の設定を「固定 1.0 秒」「ランダム 0.5〜1.5 秒」にする。回数記録なら「なし（回数記録）」 */
export function pauseLabel(pause: Pause | null): string {
  if (pause === null) return "なし（回数記録）";
  const s = (ms: number) => (ms / 1000).toFixed(1);
  return pause.mode === "fixed"
    ? `固定 ${s(pause.fixedMs)} 秒`
    : `ランダム ${s(pause.minMs)}〜${s(pause.maxMs)} 秒`;
}

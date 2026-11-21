// 開発用の試しのセット（POST /device/sets と同じ形）を作る。記録の画面を手元で作るときに使う
// 値はそれらしく見えるだけの作り物（速度カーブは半周期の山形に少し揺らぎを足したもの）
import { randomUUID } from "node:crypto";
import type { CreateSetInput, RepInput } from "@press-call/shared";

/** 再現できる疑似乱数（同じ seed なら同じ値の並び） */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

const CURVE_HZ = 50;
const round = (v: number, digits = 3) => Number(v.toFixed(digits));

function sampleRep(
  index: number,
  startOffsetMs: number,
  mode: CreateSetInput["mode"],
  fatigue: number,
  rnd: () => number,
): RepInput {
  // レップが進むほど遅くなる（疲労）
  const mean = round(Math.max(0.15, 0.62 - fatigue * 0.07 - rnd() * 0.05));
  const concentricMs = Math.round(500 + fatigue * 120 + rnd() * 100);
  const points = Math.max(2, Math.round((concentricMs / 1000) * CURVE_HZ));
  // 山形のカーブ。平均が mean になるよう、ピーク ≒ mean × π/2
  const peakTarget = (mean * Math.PI) / 2;
  const velocityCurve = Array.from({ length: points }, (_, i) =>
    round(
      Math.max(0, Math.sin((Math.PI * (i + 0.5)) / points) * peakTarget + (rnd() - 0.5) * 0.02),
    ),
  );
  const peak = Math.max(...velocityCurve);

  const signal = mode === "auto_signal";
  const pauseTargetMs = signal ? 1000 : null;
  const isPremature = signal && rnd() < 0.1;
  return {
    index,
    startOffsetMs,
    eccentricMs: Math.round(900 + rnd() * 300),
    pauseTargetMs,
    pauseActualMs: Math.round((pauseTargetMs ?? 600) + rnd() * 250),
    reactionMs: signal ? (isPremature ? 0 : Math.round(180 + rnd() * 150)) : null,
    isPremature,
    concentricMs,
    meanVelocityMps: mean,
    peakVelocityMps: round(peak),
    curveHz: CURVE_HZ,
    velocityCurve,
  };
}

/**
 * 1 日ぶんの試しのセット。
 * @param day 練習日の開始時刻（この時刻から 4 分おきにセットを置く）
 * @param count セットの数
 * @param repCount 1 セットのレップ数（省略すると 3〜6 のどれか）
 */
export function sampleSetsForDay(
  day: Date,
  count: number,
  seed: number,
  repCount?: number,
): CreateSetInput[] {
  const rnd = random(seed);
  const sets: CreateSetInput[] = [];
  for (let s = 0; s < count; s++) {
    const mode: CreateSetInput["mode"] = s % 3 === 2 ? "count_only" : "auto_signal";
    const draw = 3 + Math.floor(rnd() * 4); // 3〜6 レップ（乱数の並びを変えないよう、指定があっても引く）
    const reps: RepInput[] = [];
    let offset = 0;
    for (let r = 1; r <= (repCount ?? draw); r++) {
      reps.push(sampleRep(r, offset, mode, r - 1 + s * 0.5, rnd));
      offset += 3500 + Math.round(rnd() * 800);
    }
    const startedAt = new Date(day.getTime() + s * 4 * 60_000);
    const endedAt = new Date(startedAt.getTime() + offset + 2000);
    sets.push({
      clientSetId: randomUUID(),
      settingsVersion: 1,
      mode,
      pause: mode === "auto_signal" ? { mode: "fixed", fixedMs: 1000 } : null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      reps,
    });
  }
  return sets;
}

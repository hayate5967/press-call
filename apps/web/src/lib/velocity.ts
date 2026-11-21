// 速度分布のグラフ（FR-V03）で使う計算。画面から切り離してテストする
import type { RepSummary, SessionDetail } from "@press-call/shared";

/** どちらの速度を見るか（平均速度 MCV・最大速度 PCV） */
export type Metric = "mean" | "peak";

export const METRIC_LABELS: Record<Metric, { short: string; long: string }> = {
  mean: { short: "平均速度", long: "平均速度（MCV）" },
  peak: { short: "最大速度", long: "最大速度（PCV）" },
};

export function repValue(rep: RepSummary, metric: Metric): number | null {
  return metric === "mean" ? rep.meanVelocityMps : rep.peakVelocityMps;
}

/**
 * 縦軸の上限。その日の全レップの最大を 0.1 m/s 単位で切り上げる（セット同士を同じ目盛りで比べるため）。
 * 値が 1 つもなければ 1.0
 */
export function axisMax(session: SessionDetail, metric: Metric): number {
  let max = 0;
  for (const set of session.sets) {
    for (const rep of set.reps) max = Math.max(max, repValue(rep, metric) ?? 0);
  }
  return max === 0 ? 1 : Math.ceil(max * 10 - 1e-9) / 10;
}

export type DistributionPoint = {
  /** 何セット目か（1 始まり） */
  set: number;
  /** 横の位置。同じセットのレップが重ならないよう、セットの番号の左右に少しずらす */
  x: number;
  rep: number;
  v: number;
  premature: boolean;
};

/** セット間の分布の点。速度のないレップは出さない */
export function distributionPoints(session: SessionDetail, metric: Metric): DistributionPoint[] {
  return session.sets.flatMap((set, i) => {
    const n = set.reps.length;
    // 1 セットの点は、セットの間隔（1）の 6 割の幅に収める
    const step = n > 1 ? Math.min(0.08, 0.6 / (n - 1)) : 0;
    return set.reps.flatMap((rep, j) => {
      const v = repValue(rep, metric);
      if (v === null) return [];
      return [
        {
          set: i + 1,
          x: i + 1 + (j - (n - 1) / 2) * step,
          rep: rep.index,
          v,
          premature: rep.isPremature,
        },
      ];
    });
  });
}

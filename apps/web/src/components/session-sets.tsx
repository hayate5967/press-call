// 練習日のセットの一覧（「履歴」の練習日の画面と「今日」タブで共通）
//
// - 上の切り替えで、平均速度（MCV）と最大速度（PCV）のどちらを見るか選ぶ（下のグラフすべてに効く）
// - セット間の分布：その日の全レップを、セットごとに点で並べる（FR-V03）
// - セット内：各セットのカードに、レップごとの速度の棒グラフ。カードを押すとセットの詳細へ
// - 合図より前に挙げたレップは、色だけでなく形（▲・⚠）と説明でも示す
import type { RepSummary, SessionDetail, SessionSet } from "@press-call/shared";
import { Link } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { axisMax, distributionPoints, METRIC_LABELS, type Metric, repValue } from "@/lib/velocity";
import { formatTime, formatVelocity } from "../format";

// 点のグラフ（Recharts）は大きいので、セットが 2 つ以上あって分布を出すときだけ読み込む
const DistributionChart = lazy(() => import("@/components/distribution-chart"));

export function SessionSets(props: { session: SessionDetail }) {
  const { session } = props;
  const { sets } = session;
  const [metric, setMetric] = useState<Metric>("mean");
  const repTotal = sets.reduce((sum, s) => sum + s.repCount, 0);
  const max = axisMax(session, metric);
  const points = distributionPoints(session, metric);
  const hasPremature = points.some((p) => p.premature);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {sets.length} セット・{repTotal} レップ
        </p>
        <MetricToggle value={metric} onChange={setMetric} />
      </div>

      {sets.length >= 2 && points.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>セットごとの{METRIC_LABELS[metric].short}</CardTitle>
            <CardDescription>1 つの点が 1 レップ。横軸はセットの順番、縦軸は m/s</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {hasPremature && <Legend />}
            <Suspense fallback={<Skeleton className="h-52 w-full" />}>
              <DistributionChart
                points={points}
                setCount={sets.length}
                max={max}
                label={METRIC_LABELS[metric].short}
              />
            </Suspense>
          </CardContent>
        </Card>
      )}

      {sets.map((set, i) => (
        <SetCard key={set.id} set={set} number={i + 1} metric={metric} max={max} />
      ))}
    </div>
  );
}

/** MCV と PCV の切り替え（iOS のセグメントコントロール） */
function MetricToggle(props: { value: Metric; onChange: (m: Metric) => void }) {
  return (
    <fieldset className="flex shrink-0 rounded-full bg-secondary p-1">
      <legend className="sr-only">表示する速度</legend>
      {(["mean", "peak"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={props.value === m}
          onClick={() => props.onChange(m)}
          className={cn(
            "h-9 rounded-full px-3.5 text-sm font-semibold transition-colors",
            props.value === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {m === "mean" ? "MCV" : "PCV"}
          <span className="sr-only">（{METRIC_LABELS[m].short}）</span>
        </button>
      ))}
    </fieldset>
  );
}

/** 凡例。文字は文字の色にし、色は横の印で示す */
export function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-chart-rep" aria-hidden />
        レップ
      </span>
      <span className="flex items-center gap-1.5">
        <TriangleAlert className="size-3.5 fill-chart-premature text-card" aria-hidden />
        合図より前に挙げたレップ
      </span>
    </div>
  );
}

/** 重量と RPE（まだ入力していなければ「重量は未入力」） */
function loadLabel(set: SessionSet): string {
  const parts = [];
  if (set.weightKg !== null) parts.push(`${set.weightKg} kg`);
  if (set.rpe !== null) parts.push(`RPE ${set.rpe}`);
  return parts.length > 0 ? parts.join("・") : "重量は未入力";
}

function SetCard(props: { set: SessionSet; number: number; metric: Metric; max: number }) {
  const { set } = props;
  return (
    // カード全体を押すと、そのセットの詳細（速度カーブなど）へ
    <Link
      to="/sets/$setId"
      params={{ setId: set.id }}
      aria-label={`セット ${props.number}（${formatTime(set.startedAt)}）の詳細を開く`}
      className="block rounded-xl transition-transform active:scale-[0.99]"
    >
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              セット {props.number}
              {set.mode === "count_only" && <Badge variant="secondary">回数記録</Badge>}
            </CardTitle>
            <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
              {formatTime(set.startedAt)}
              <ChevronRight className="size-5" aria-hidden />
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {set.repCount} レップ・{loadLabel(set)}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {set.reps.length > 0 ? (
            <RepBars reps={set.reps} metric={props.metric} max={props.max} />
          ) : (
            <p className="text-sm text-muted-foreground">レップは記録されていません。</p>
          )}
          {set.note && <p className="rounded-md bg-secondary px-3 py-2 text-sm">{set.note}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * レップごとの速度の棒グラフ（セット内の分布）。
 * 縦の目盛りはその日の全セットで同じにして、セット同士を見比べられるようにする。
 * カード全体が詳細へのリンクなので、ホバーで値を出す代わりに、棒の上に値を書く。
 * 速度はいちばん大事な値なので大きく書く。スマホの幅に収まるよう、レップが多いほど小さくする。
 * 13 レップ以上は 1 本の幅を保ったまま横にスクロールする（値を省かない）
 */
function RepBars(props: { reps: RepSummary[]; metric: Metric; max: number }) {
  const { reps, metric, max } = props;
  const size = valueSize(reps.length);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs text-muted-foreground">
        レップごとの{METRIC_LABELS[metric].long}・m/s
      </figcaption>
      {/* 棒と番号を一緒に横スクロールさせる（幅に収まるあいだはスクロールしない） */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex flex-col gap-1" style={{ minWidth: size.minWidth(reps.length) }}>
          <ol className="flex h-40 items-end gap-0.5 border-b border-border">
            {reps.map((rep) => {
              const v = repValue(rep, metric);
              const label = `${rep.index} レップ目 ${v === null ? "記録なし" : `${formatVelocity(v)} m/s`}${rep.isPremature ? "（合図より前に挙げた）" : ""}`;
              return (
                <li
                  key={rep.index}
                  aria-label={label}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <span
                    className={cn(
                      "font-semibold whitespace-nowrap text-foreground",
                      size.className,
                    )}
                  >
                    {formatVelocity(v)}
                  </span>
                  {v !== null && (
                    // 太さは 24px まで。上の角だけ 4px 丸め、根元は四角にする
                    <span
                      className={cn(
                        "w-full max-w-6 rounded-t-[4px]",
                        rep.isPremature ? "bg-chart-premature" : "bg-chart-rep",
                      )}
                      // 値の文字の高さ（＋すき間 0.25rem）を除いた高さを最大として比べる
                      style={{ height: `max(2px, calc((100% - ${size.reserve}) * ${v / max}))` }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          {/* レップの番号。合図より前に挙げたレップは ⚠ を付ける */}
          <ol className="flex gap-0.5" aria-hidden>
            {reps.map((rep) => (
              <li
                key={rep.index}
                className="flex min-w-0 flex-1 items-center justify-center gap-0.5 text-xs text-muted-foreground tabular-nums"
              >
                {rep.isPremature && (
                  <TriangleAlert className="size-3 fill-chart-premature text-card" />
                )}
                {rep.index}
              </li>
            ))}
          </ol>
        </div>
      </div>
      {reps.some((r) => r.isPremature) && <Legend />}
    </figure>
  );
}

/**
 * 棒の上の値の文字の大きさ。375px 幅の iPhone で「0.52」が棒 1 本の幅に収まる大きさにする。
 * 棒 1 本の幅：6 本なら約 48px、8 本なら約 36px、10 本なら約 28px、12 本なら約 23px
 */
function valueSize(repCount: number): {
  className: string;
  /** 値の文字の高さ＋すき間。棒の高さの計算でこの分を除く */
  reserve: string;
  /** これより狭くなるなら横にスクロールする（13 レップ以上は 1 本 24px を保つ） */
  minWidth: (n: number) => number | undefined;
} {
  const none = () => undefined;
  if (repCount <= 6) return { className: "text-xl leading-7", reserve: "2rem", minWidth: none };
  if (repCount <= 8) return { className: "text-sm leading-5", reserve: "1.5rem", minWidth: none };
  // 9 レップ以上は 12px。12 本だと 1 本の幅（約 23px）が「0.52」（約 25px）より少し狭いので、
  // 字間を詰めて収める
  return {
    className: "text-xs leading-4 tracking-tighter",
    reserve: "1.25rem",
    minWidth: (n) => (n > 12 ? n * 26 : undefined),
  };
}

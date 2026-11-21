// セット間の速度分布（FR-V03）。横軸がセット、縦軸が速度で、1 つの点が 1 レップ。
// Recharts は大きいので、練習日の画面で分布を出すときだけ読み込む（lazy）
//
// 合図より前に挙げたレップは、色（--chart-premature）に加えて形（▲）でも区別する。
// 点には 2px のカードの色の縁を付け、重なっても 1 つずつ見えるようにする
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { DistributionPoint } from "@/lib/velocity";
import { formatVelocity } from "../format";

export default function DistributionChart(props: {
  points: DistributionPoint[];
  setCount: number;
  max: number;
  /** 速度の名前（平均速度・最大速度） */
  label: string;
}) {
  const normal = props.points.filter((p) => !p.premature);
  const premature = props.points.filter((p) => p.premature);
  const ticks = Array.from({ length: props.setCount }, (_, i) => i + 1);

  return (
    // 高さは軸の文字も含めて決める
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0.5, props.setCount + 0.5]}
            ticks={ticks}
            tickFormatter={(n: number) => `${n}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            interval={0}
          />
          <YAxis
            dataKey="v"
            type="number"
            domain={[0, props.max]}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          {/* 点の大きさ（面積）。半径およそ 5px */}
          <ZAxis range={[80, 80]} />
          <Scatter
            data={normal}
            fill="var(--chart-rep)"
            stroke="var(--card)"
            strokeWidth={2}
            shape="circle"
            isAnimationActive={false}
          />
          <Scatter
            data={premature}
            fill="var(--chart-premature)"
            stroke="var(--card)"
            strokeWidth={2}
            shape="triangle"
            isAnimationActive={false}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as DistributionPoint | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md bg-popover px-3 py-2 text-sm text-popover-foreground shadow-card">
                  <div className="font-semibold tabular-nums">{formatVelocity(p.v)} m/s</div>
                  <div className="text-xs text-muted-foreground">
                    {p.set} セット目・{p.rep} レップ目の{props.label}
                    {p.premature && "（合図より前）"}
                  </div>
                </div>
              );
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

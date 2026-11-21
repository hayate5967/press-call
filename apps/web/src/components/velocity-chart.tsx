// レップの速度カーブ（FR-V02）。Recharts は大きいので、セットの詳細画面でだけ読み込む（lazy）
//
// 見せ方：選んだレップだけをメインの青で描き（線 2px と、うすい塗り）、ほかのレップは比べるための
// うすい灰色にする。色の意味は 1 つ（青＝今見ているレップ）なので、凡例は付けず見出しで示す
import type { RepDetail } from "@press-call/shared";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { curvePoints } from "@/lib/set-detail";

type Row = { t: number } & Record<string, number | undefined>;

const key = (index: number) => `r${index}`;

/** 全レップのカーブを、時刻をそろえた 1 つの表にする（同じ時刻の行に各レップの速度を入れる） */
function mergeCurves(reps: RepDetail[]): Row[] {
  const rows = new Map<number, Row>();
  for (const rep of reps) {
    for (const p of curvePoints(rep)) {
      const row: Row = rows.get(p.t) ?? { t: p.t };
      row[key(rep.index)] = p.v;
      rows.set(p.t, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

export default function VelocityChart(props: { reps: RepDetail[]; selected: number }) {
  const data = mergeCurves(props.reps);
  const selectedRep = props.reps.find((r) => r.index === props.selected);
  const peak = selectedRep
    ? curvePoints(selectedRep).reduce<{ t: number; v: number } | null>(
        (best, p) => (best === null || p.v > best.v ? p : best),
        null,
      )
    : null;
  const others = props.reps.filter((r) => r.index !== props.selected);

  return (
    // 高さは軸の文字も含めて決める（軸が切れて中だけスクロールしないように）
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={(t: number) => `${(t / 1000).toFixed(1)}`}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            unit=" 秒"
          />
          <YAxis
            domain={[0, "auto"]}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          {/* 比べるためのほかのレップ（触っても反応しない） */}
          {others.map((r) => (
            <Line
              key={r.index}
              dataKey={key(r.index)}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.3}
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              connectNulls
              isAnimationActive={false}
              tooltipType="none"
            />
          ))}
          <Area
            dataKey={key(props.selected)}
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="var(--primary)"
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
          {/* 最大速度（PCV）の位置 */}
          {peak && (
            <ReferenceDot
              x={peak.t}
              y={peak.v}
              r={4}
              fill="var(--primary)"
              stroke="var(--card)"
              strokeWidth={2}
            />
          )}
          <Tooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              const v = payload?.find((p) => p.dataKey === key(props.selected))?.value;
              if (!active || typeof v !== "number" || typeof label !== "number") return null;
              return (
                <div className="rounded-md bg-popover px-3 py-2 text-sm text-popover-foreground shadow-card">
                  <div className="font-semibold tabular-nums">{v.toFixed(2)} m/s</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {(label / 1000).toFixed(2)} 秒
                  </div>
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

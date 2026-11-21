// 練習日のセットの一覧（「履歴」の練習日の画面と「今日」タブで共通）
// レップごとの平均速度（MCV）を並べ、押すとセットの詳細へ。速度分布のグラフ（FR-V03）は別の PR で足す
import type { SessionDetail, SessionSet } from "@press-call/shared";
import { Link } from "@tanstack/react-router";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatTime, formatVelocity } from "../format";

export function SessionSets(props: { session: SessionDetail }) {
  const { sets } = props.session;
  const repTotal = sets.reduce((sum, s) => sum + s.repCount, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {sets.length} セット・{repTotal} レップ
      </p>
      {sets.map((set, i) => (
        <SetCard key={set.id} set={set} number={i + 1} />
      ))}
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

function SetCard(props: { set: SessionSet; number: number }) {
  const { set } = props;
  const hasPremature = set.reps.some((r) => r.isPremature);
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
            <>
              <p className="text-xs text-muted-foreground">レップごとの平均速度（m/s）</p>
              <ol className="grid grid-cols-5 gap-2">
                {set.reps.map((rep) => (
                  <li
                    key={rep.index}
                    className={cn(
                      "flex flex-col items-center rounded-md py-2",
                      rep.isPremature ? "bg-warning/12 text-warning" : "bg-secondary",
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center gap-0.5 text-xs",
                        !rep.isPremature && "text-muted-foreground",
                      )}
                    >
                      {rep.isPremature && <TriangleAlert className="size-3" aria-hidden />}
                      {rep.index}
                    </span>
                    <span className="text-base font-semibold tabular-nums">
                      {formatVelocity(rep.meanVelocityMps)}
                    </span>
                    {/* 色と印だけに頼らず、読み上げでも分かるようにする */}
                    {rep.isPremature && <span className="sr-only">（合図より前に挙げた）</span>}
                  </li>
                ))}
              </ol>
              {hasPremature && (
                <p className="flex items-center gap-1 text-xs text-warning">
                  <TriangleAlert className="size-3.5" aria-hidden />
                  合図より前に挙げたレップ
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">レップは記録されていません。</p>
          )}
          {set.note && <p className="rounded-md bg-secondary px-3 py-2 text-sm">{set.note}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

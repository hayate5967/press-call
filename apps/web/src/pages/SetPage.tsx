// セットの詳細画面（/sets/{setId}）。レップごとの速度カーブ（FR-V02）と、
// 自動合図モードの静止時間・反応時間・フライングの有無（FR-V08）
import type { RepDetail, SetDetail } from "@press-call/shared";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { ErrorAlert, Loading, Page } from "@/components/layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSeconds, pauseLabel } from "@/lib/set-detail";
import { cn } from "@/lib/utils";
import { dateInJapan, formatSessionDate, formatTime, formatVelocity } from "../format";
import { errorMessage } from "../messages";
import { setDetailQuery } from "../queries";

// グラフの部品（Recharts）は大きいので、この画面を開いたときにだけ読み込む
const VelocityChart = lazy(() => import("@/components/velocity-chart"));

const route = getRouteApi("/auth/sets/$setId");

export function SetPage() {
  const { setId } = route.useParams();
  const set = useQuery(setDetailQuery(setId));
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();

  // 「今日」からも「履歴」からも来るので、前の画面へ戻る。直接開いたときはその日の画面へ
  const onBack = () => {
    if (canGoBack) router.history.back();
    else if (set.data) {
      void navigate({ to: "/history/$sessionId", params: { sessionId: set.data.sessionId } });
    } else void navigate({ to: "/history" });
  };

  return (
    <Page
      title={set.data ? `${formatTime(set.data.startedAt)} のセット` : "セット"}
      subtitle={set.data ? formatSessionDate(dateInJapan(new Date(set.data.startedAt))) : undefined}
      back={{ label: "戻る", onClick: onBack }}
    >
      {set.isPending && <Loading />}
      <ErrorAlert message={set.error ? errorMessage(set.error) : null} />
      {set.data && <SetDetailView set={set.data} />}
    </Page>
  );
}

function SetDetailView(props: { set: SetDetail }) {
  const { set } = props;
  const [selected, setSelected] = useState(set.reps[0]?.index ?? 1);
  const rep = set.reps.find((r) => r.index === selected);
  const auto = set.mode === "auto_signal";
  const hasCurve = set.reps.some((r) => r.velocityCurve && r.velocityCurve.length > 0);

  return (
    <>
      {rep ? (
        <Card>
          <CardHeader>
            <CardTitle>速度カーブ</CardTitle>
            <CardDescription>
              青が {rep.index} レップ目、灰色はほかのレップ。縦軸は速度（m/s）
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RepPicker reps={set.reps} selected={selected} onSelect={setSelected} />
            {hasCurve ? (
              <Suspense fallback={<Skeleton className="h-56 w-full" />}>
                <VelocityChart reps={set.reps} selected={selected} />
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground">速度カーブは記録されていません。</p>
            )}
            <RepStats rep={rep} auto={auto} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">レップは記録されていません。</p>
          </CardContent>
        </Card>
      )}

      {set.reps.length > 0 && <RepTable reps={set.reps} auto={auto} />}

      <Card>
        <CardHeader>
          <CardTitle>セットの情報</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border/70">
            <InfoRow label="モード">{auto ? "自動合図" : "回数記録"}</InfoRow>
            {auto && <InfoRow label="待ち時間の設定">{pauseLabel(set.pause)}</InfoRow>}
            <InfoRow label="時間">
              {formatTime(set.startedAt)}〜{formatTime(set.endedAt)}
            </InfoRow>
            <InfoRow label="重量">
              {set.weightKg === null ? "未入力" : `${set.weightKg} kg`}
            </InfoRow>
            <InfoRow label="RPE">{set.rpe === null ? "未入力" : set.rpe}</InfoRow>
            {set.note && <InfoRow label="メモ">{set.note}</InfoRow>}
            <InfoRow label="生データ">{set.hasRawData ? "あり" : "なし"}</InfoRow>
          </dl>
        </CardContent>
      </Card>
    </>
  );
}

/** 見るレップを選ぶボタンの列。合図より前に挙げたレップには印を付ける */
function RepPicker(props: {
  reps: RepDetail[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">レップを選ぶ</legend>
      {props.reps.map((r) => {
        const on = r.index === props.selected;
        return (
          <button
            key={r.index}
            type="button"
            aria-pressed={on}
            onClick={() => props.onSelect(r.index)}
            className={cn(
              "relative flex size-11 items-center justify-center rounded-full text-base font-semibold tabular-nums transition-colors active:scale-95",
              on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            {r.index}
            {r.isPremature && (
              <TriangleAlert
                className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-card p-0.5 text-warning"
                aria-label="合図より前に挙げた"
              />
            )}
          </button>
        );
      })}
    </fieldset>
  );
}

/** 選んだレップの数値 */
function RepStats(props: { rep: RepDetail; auto: boolean }) {
  const { rep, auto } = props;
  return (
    <div className="flex flex-col gap-3">
      {rep.isPremature && (
        <Alert className="bg-warning/12 text-warning">
          <TriangleAlert aria-hidden />
          <AlertTitle>フライング</AlertTitle>
          <AlertDescription>
            <p>Press の合図より前に挙げ始めました。</p>
          </AlertDescription>
        </Alert>
      )}
      <dl className="grid grid-cols-2 gap-2">
        {/* いちばん大事な値なので、ほかの数値より大きく書く */}
        <Stat label="平均速度（MCV）" value={formatVelocity(rep.meanVelocityMps)} unit="m/s" hero />
        <Stat label="最大速度（PCV）" value={formatVelocity(rep.peakVelocityMps)} unit="m/s" hero />
        <Stat label="下ろす時間" value={formatSeconds(rep.eccentricMs)} />
        <Stat label="挙げる時間" value={formatSeconds(rep.concentricMs)} />
        {auto && (
          <>
            <Stat
              label="静止時間"
              value={formatSeconds(rep.pauseActualMs)}
              note={
                rep.pauseTargetMs === null ? undefined : `目標 ${formatSeconds(rep.pauseTargetMs)}`
              }
            />
            <Stat
              label="反応時間"
              value={rep.isPremature ? "フライング" : formatSeconds(rep.reactionMs)}
              note="合図から挙げ始めるまで"
            />
          </>
        )}
      </dl>
    </div>
  );
}

function Stat(props: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** 大きく見せる値（速度） */
  hero?: boolean;
}) {
  return (
    <div className="rounded-md bg-secondary px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={cn("font-semibold", props.hero ? "text-4xl leading-tight" : "text-lg")}>
        {props.value}
        {props.unit && (
          <span className="ml-1 text-sm font-medium text-muted-foreground">{props.unit}</span>
        )}
      </dd>
      {props.note && <dd className="text-xs text-muted-foreground">{props.note}</dd>}
    </div>
  );
}

/** 全レップの数値の表（グラフを見なくても値が読めるように） */
function RepTable(props: { reps: RepDetail[]; auto: boolean }) {
  const { reps, auto } = props;
  const th = "px-2 py-2 text-right text-xs font-medium text-muted-foreground";
  const td = "px-2 py-2.5 text-right tabular-nums";
  return (
    <Card>
      <CardHeader>
        <CardTitle>レップの一覧</CardTitle>
      </CardHeader>
      <CardContent className="-mx-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th scope="col" className={cn(th, "text-left")}>
                レップ
              </th>
              <th scope="col" className={th}>
                平均 m/s
              </th>
              <th scope="col" className={th}>
                最大 m/s
              </th>
              {auto && (
                <>
                  <th scope="col" className={th}>
                    静止 秒
                  </th>
                  <th scope="col" className={th}>
                    反応 秒
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {reps.map((r) => (
              <tr key={r.index}>
                <th scope="row" className="px-2 py-2.5 text-left font-medium">
                  <span className="flex items-center gap-1">
                    {r.index}
                    {r.isPremature && (
                      <TriangleAlert className="size-3.5 text-warning" aria-label="フライング" />
                    )}
                  </span>
                </th>
                <td className={cn(td, "text-base font-semibold")}>
                  {formatVelocity(r.meanVelocityMps)}
                </td>
                <td className={cn(td, "text-base font-semibold")}>
                  {formatVelocity(r.peakVelocityMps)}
                </td>
                {auto && (
                  <>
                    <td className={td}>{seconds(r.pauseActualMs)}</td>
                    <td className={td}>{r.isPremature ? "—" : seconds(r.reactionMs)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const seconds = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(2));

function InfoRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="text-right">{props.children}</dd>
    </div>
  );
}

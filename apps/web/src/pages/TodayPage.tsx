// 「今日」タブ。今日（日本時間）の練習日があれば、そのセットとレップの速度を出す。
// 開いているあいだは数秒おきに新しいセットを問い合わせ、届いたら表示を新しくして目立たせる（FR-V07）
import type { NewSet } from "@press-call/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorAlert, Loading, Page } from "@/components/layout";
import { RecordingControl } from "@/components/recording-control";
import { SessionSets } from "@/components/session-sets";
import { Button } from "@/components/ui/button";
import { useLiveSets } from "@/lib/live-sets";
import { cn } from "@/lib/utils";
import { formatSessionDate, todayInJapan } from "../format";
import { errorMessage } from "../messages";
import { latestSessionQuery, sessionDetailQuery } from "../queries";

/** 新しく届いたセットを目立たせておく時間 */
const HIGHLIGHT_MS = 2 * 60 * 1000;

export function TodayPage() {
  const today = todayInJapan();
  const latest = useQuery(latestSessionQuery);
  const todaysId = latest.data?.date === today ? latest.data.id : null;
  const session = useQuery({ ...sessionDetailQuery(todaysId ?? ""), enabled: todaysId !== null });
  const { highlightIds, announcement, onFresh } = useHighlights();
  const live = useLiveSets(onFresh);

  const error = latest.error ?? session.error;
  return (
    <Page title="今日" subtitle={formatSessionDate(today)}>
      <LiveStatus failing={live.failing} paused={live.paused} onResume={live.resume} />
      {/* 読み上げソフトにも新しいセットが届いたことを知らせる */}
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {(latest.isPending || (todaysId && session.isPending)) && !error && <Loading />}
      <ErrorAlert message={error ? errorMessage(error) : null} />
      {latest.isSuccess && todaysId === null && (
        <EmptyState icon={Activity} title="今日はまだセットがありません">
          <p>
            デバイスの電源を入れ、下の「セット開始」を押してからセットを始めると、ここに記録が出ます。つなぎ方は
            <Link to="/settings" className="font-semibold text-primary">
              設定
            </Link>
            タブを見てください。
          </p>
        </EmptyState>
      )}
      {session.data && (
        <SessionSets session={session.data} highlightIds={highlightIds} newestFirst />
      )}
      {/* 下に固定した開始・終了ボタンに、最後の内容が隠れないよう空けておく */}
      <div aria-hidden className="h-48" />
      <RecordingControl />
    </Page>
  );
}

/** 自動で更新していることを小さく示す（つながらない・止めたときはそう出す） */
function LiveStatus(props: { failing: boolean; paused: boolean; onResume: () => void }) {
  if (props.paused) {
    return (
      <div className="-mt-3 flex items-center justify-between gap-3 rounded-md bg-secondary py-1 pr-1 pl-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground" />
          30 分新しいセットがないので、自動更新を止めました
        </p>
        <Button size="sm" variant="secondary" className="h-11 shrink-0" onClick={props.onResume}>
          <RefreshCw aria-hidden />
          再開
        </Button>
      </div>
    );
  }
  return (
    <p className="-mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          props.failing ? "bg-warning" : "bg-success motion-safe:animate-pulse",
        )}
      />
      {props.failing
        ? "更新できません。電波の状態を確認してください（つながると自動で戻ります）"
        : "新しいセットが届くと自動で表示します"}
    </p>
  );
}

/** 新しく届いたセットの ID を、しばらくのあいだ覚えておく */
function useHighlights() {
  const [highlightIds, setHighlightIds] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => {
      for (const t of list) clearTimeout(t);
    };
  }, []);

  const onFresh = useCallback((sets: NewSet[]) => {
    const ids = sets.map((s) => s.id);
    setHighlightIds((prev) => new Set([...prev, ...ids]));
    setAnnouncement(
      sets.length === 1
        ? `新しいセット（${sets[0]?.repCount ?? 0} レップ）が届きました`
        : `新しいセットが ${sets.length} つ届きました`,
    );
    timers.current.push(
      setTimeout(() => {
        setHighlightIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      }, HIGHLIGHT_MS),
    );
  }, []);

  return { highlightIds, announcement, onFresh };
}

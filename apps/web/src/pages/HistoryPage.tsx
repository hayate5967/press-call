// 「履歴」タブ。練習日の一覧を新しい順に出す（FR-V01）。押すとその日のセットへ
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, History } from "lucide-react";
import { EmptyState, ErrorAlert, Loading, Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { formatSessionDate } from "../format";
import { errorMessage } from "../messages";
import { sessionListQuery } from "../queries";

export function HistoryPage() {
  const list = useInfiniteQuery(sessionListQuery);
  const sessions = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page title="履歴">
      {list.isPending && <Loading />}
      <ErrorAlert message={list.error ? errorMessage(list.error) : null} />
      {list.isSuccess && sessions.length === 0 && (
        <EmptyState icon={History} title="まだ記録がありません">
          <p>デバイスでセットを終えると、練習日ごとにここに並びます。</p>
        </EmptyState>
      )}
      {sessions.length > 0 && (
        // iOS の設定アプリのように、行全体を押すとその日のセットへ進む
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl bg-card shadow-card">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                to="/history/$sessionId"
                params={{ sessionId: s.id }}
                className="flex min-h-15 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-accent active:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{formatSessionDate(s.date)}</div>
                  <div className="text-sm text-muted-foreground">
                    {s.setCount} セット・{s.repCount} レップ
                  </div>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
        </Button>
      )}
    </Page>
  );
}

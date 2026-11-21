// 「履歴」タブ。練習日（セッション）の一覧を新しい順に出す。
// 中身は記録を返す API（GET /sessions）と一緒に作る
import { History } from "lucide-react";
import { EmptyState, Page } from "@/components/layout";

export function HistoryPage() {
  return (
    <Page title="履歴">
      <EmptyState icon={History} title="練習日の一覧（準備中）">
        <p>これまでの練習日とセットを、新しい順にここに表示する予定です。</p>
      </EmptyState>
    </Page>
  );
}

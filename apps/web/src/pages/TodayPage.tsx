// 「今日」タブ。今日のセッション（セットの一覧・レップごとの速度）を出す。
// 中身は記録を返す API（GET /sessions・GET /sets）と一緒に次の PR で作る
import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { EmptyState, Page } from "@/components/layout";

export function TodayPage() {
  return (
    <Page title="今日">
      <EmptyState icon={Activity} title="今日のセッション（準備中）">
        <p>
          セットごとの記録（レップごとの速度など）は、ここに表示する予定です。デバイスの登録や設定は
          <Link to="/settings" className="font-semibold text-primary">
            設定
          </Link>
          タブから行えます。
        </p>
      </EmptyState>
    </Page>
  );
}

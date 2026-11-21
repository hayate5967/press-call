// 「今日」タブ。今日（日本時間）の練習日があれば、そのセットとレップの速度を出す。
// 練習中に数秒おきに更新する（FR-V07）のは別の PR で足す。今は開いたとき・画面に戻ったときに読み直す
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { EmptyState, ErrorAlert, Loading, Page } from "@/components/layout";
import { SessionSets } from "@/components/session-sets";
import { formatSessionDate, todayInJapan } from "../format";
import { errorMessage } from "../messages";
import { latestSessionQuery, sessionDetailQuery } from "../queries";

export function TodayPage() {
  const today = todayInJapan();
  const latest = useQuery(latestSessionQuery);
  const todaysId = latest.data?.date === today ? latest.data.id : null;
  const session = useQuery({ ...sessionDetailQuery(todaysId ?? ""), enabled: todaysId !== null });

  const error = latest.error ?? session.error;
  return (
    <Page title="今日">
      <p className="-mt-3 text-sm text-muted-foreground">{formatSessionDate(today)}</p>
      {(latest.isPending || (todaysId && session.isPending)) && !error && <Loading />}
      <ErrorAlert message={error ? errorMessage(error) : null} />
      {latest.isSuccess && todaysId === null && (
        <EmptyState icon={Activity} title="今日はまだセットがありません">
          <p>
            デバイスの電源を入れてセットを始めると、ここに記録が出ます。つなぎ方は
            <Link to="/settings" className="font-semibold text-primary">
              設定
            </Link>
            タブを見てください。
          </p>
        </EmptyState>
      )}
      {session.data && <SessionSets session={session.data} />}
    </Page>
  );
}

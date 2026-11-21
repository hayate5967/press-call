// 練習日の画面（/history/{sessionId}）。その日のセットとレップの速度（FR-V01）
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CalendarX } from "lucide-react";
import { EmptyState, ErrorAlert, Loading, Page } from "@/components/layout";
import { SessionSets } from "@/components/session-sets";
import { ApiProblem } from "../api/client";
import { formatSessionDate } from "../format";
import { errorMessage } from "../messages";
import { sessionDetailQuery } from "../queries";

const route = getRouteApi("/auth/history/$sessionId");

export function SessionPage() {
  const { sessionId } = route.useParams();
  const session = useQuery(sessionDetailQuery(sessionId));
  return (
    <Page title={session.data ? formatSessionDate(session.data.date) : "練習日"} back="/history">
      {session.isPending && <Loading />}
      {/* セットをすべて削除した日は 404 になる（一覧にも出ない） */}
      {session.error instanceof ApiProblem && session.error.status === 404 ? (
        <EmptyState icon={CalendarX} title="この日の記録はありません">
          <p>セットがすべて削除されたか、別のアカウントの記録です。</p>
        </EmptyState>
      ) : (
        <ErrorAlert message={session.error ? errorMessage(session.error) : null} />
      )}
      {session.data && <SessionSets session={session.data} />}
    </Page>
  );
}

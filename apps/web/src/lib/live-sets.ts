// 練習中の自動更新（FR-V07）。「今日」タブを開いているあいだ、新しく届いたセットを数秒おきに問い合わせる
import type { NewSet, NewSetList } from "@press-call/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { queryKeys } from "../queries";

/** 問い合わせの間隔（API 仕様書の「3 秒おき」） */
export const LIVE_POLL_MS = 3000;

/**
 * この時間、新しいセットが届かなければ問い合わせを止める。
 * 画面を開いたまま置いておくと 3 秒おきに DB へ問い合わせが続き、Neon が休止できないため
 */
export const LIVE_IDLE_MS = 30 * 60 * 1000;

/** 最後に動きがあった時刻（開いた・再開した・セットが届いた）から、止める時間がたったか */
export function isIdle(lastActivityMs: number, nowMs: number, idleMs = LIVE_IDLE_MS): boolean {
  return nowMs - lastActivityMs >= idleMs;
}

/**
 * まだ見ていないセットだけを返し、見たものとして seen に足す。
 * サーバは取りこぼし防止のため同じセットを続けて返すことがあるので、ID で除く
 */
export function takeFresh(items: NewSet[], seen: Set<string>): NewSet[] {
  const fresh: NewSet[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  return fresh;
}

/** 問い合わせの URL。最初の 1 回は createdAfter を付けず、サーバの時刻だけをもらう */
export function newSetsPath(cursor: string | null): string {
  return cursor === null ? "/sets" : `/sets?createdAfter=${encodeURIComponent(cursor)}`;
}

/**
 * 新しく届いたセットを数秒おきに問い合わせ、届いたら onFresh を呼ぶ（記録の表示は読み直す）。
 * - 画面が裏に回っているあいだ（別のアプリ・別のタブ・画面を消した）は問い合わせない
 * - 30 分新しいセットが届かなければ止める（paused）。resume で再開し、画面に戻ってきたときも再開する
 */
export function useLiveSets(onFresh: (sets: NewSet[]) => void) {
  const queryClient = useQueryClient();
  // 次の問い合わせの createdAfter（前回の serverTime）と、もう知らせたセットの ID
  const cursor = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const onFreshRef = useRef(onFresh);
  onFreshRef.current = onFresh;
  const lastActivity = useRef(Date.now());
  const [paused, setPaused] = useState(false);

  const resume = useCallback(() => {
    lastActivity.current = Date.now();
    setPaused(false);
  }, []);

  // 30 秒ごとに、止める時間がたったか見る
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      if (isIdle(lastActivity.current, Date.now())) setPaused(true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [paused]);

  // 別のアプリやタブから戻ってきたら再開する（見に来たということなので）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [resume]);

  const query = useQuery({
    queryKey: queryKeys.newSets,
    queryFn: async () => {
      const { data } = await api.json<NewSetList>(newSetsPath(cursor.current));
      cursor.current = data.serverTime;
      return takeFresh(data.items, seen.current);
    },
    enabled: !paused,
    refetchInterval: paused ? false : LIVE_POLL_MS,
    refetchIntervalInBackground: false,
    // 画面を離れたら捨てる（戻ってきたら最初の 1 回からやり直す）
    gcTime: 0,
    retry: false,
  });

  const fresh = query.data;
  useEffect(() => {
    if (!fresh || fresh.length === 0) return;
    lastActivity.current = Date.now();
    // 今日の練習日・練習日の一覧を読み直して、新しいセットを出す
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    onFreshRef.current(fresh);
  }, [fresh, queryClient]);

  return { failing: query.isError && !paused, paused, resume };
}

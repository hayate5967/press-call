// API から取るデータ（TanStack Query）。キーと取り方をここにまとめ、画面とルーターから同じものを使う
import type {
  Device,
  DeviceSettingsDetail,
  Me,
  SessionDetail,
  SessionList,
  SetDetail,
} from "@press-call/shared";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./api/client";

export const queryKeys = {
  me: ["me"] as const,
  devices: ["devices"] as const,
  deviceSettings: (deviceId: string) => ["devices", deviceId, "settings"] as const,
  sessions: ["sessions"] as const,
  sessionList: ["sessions", "list"] as const,
  latestSession: ["sessions", "latest"] as const,
  session: (sessionId: string) => ["sessions", "detail", sessionId] as const,
  set: (setId: string) => ["sets", setId] as const,
};

/** ログイン中のユーザー。取れなければ AuthRequiredError（ログインしていない） */
export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: async () => (await api.json<Me>("/me")).data,
  // 名前とメールはめったに変わらないので、画面を移るたびには取り直さない
  staleTime: Number.POSITIVE_INFINITY,
  // 失敗（未ログイン）はルーターが扱う。main.tsx の「途中でログインが切れた」処理の対象から外す
  meta: { authCheck: true },
});

export const devicesQuery = queryOptions({
  queryKey: queryKeys.devices,
  queryFn: async () => (await api.json<{ items: Device[] }>("/devices")).data.items,
});

export const deviceSettingsQuery = (deviceId: string) =>
  queryOptions({
    queryKey: queryKeys.deviceSettings(deviceId),
    queryFn: async () =>
      (await api.json<DeviceSettingsDetail>(`/devices/${deviceId}/settings`)).data,
  });

const fetchSessions = async (query: string) =>
  (await api.json<SessionList>(`/sessions?${query}`)).data;

/** 練習日の一覧（新しい順）。「もっと見る」で nextCursor を使って続きを足す */
export const sessionListQuery = infiniteQueryOptions({
  queryKey: queryKeys.sessionList,
  queryFn: ({ pageParam }) =>
    fetchSessions(
      new URLSearchParams({ limit: "20", ...(pageParam ? { cursor: pageParam } : {}) }).toString(),
    ),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.nextCursor,
});

/** いちばん新しい練習日（「今日」タブで、今日の練習日があるかを見る） */
export const latestSessionQuery = queryOptions({
  queryKey: queryKeys.latestSession,
  queryFn: async () => (await fetchSessions("limit=1")).items[0] ?? null,
});

/** 練習日のセットとレップ */
export const sessionDetailQuery = (sessionId: string) =>
  queryOptions({
    queryKey: queryKeys.session(sessionId),
    queryFn: async () => (await api.json<SessionDetail>(`/sessions/${sessionId}`)).data,
  });

/** セットの詳細（各レップの速度カーブつき） */
export const setDetailQuery = (setId: string) =>
  queryOptions({
    queryKey: queryKeys.set(setId),
    queryFn: async () => (await api.json<SetDetail>(`/sets/${setId}`)).data,
  });

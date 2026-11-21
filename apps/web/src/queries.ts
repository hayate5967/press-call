// API から取るデータ（TanStack Query）。キーと取り方をここにまとめ、画面とルーターから同じものを使う
import type { Device, DeviceSettingsDetail, Me } from "@press-call/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api/client";

export const queryKeys = {
  me: ["me"] as const,
  devices: ["devices"] as const,
  deviceSettings: (deviceId: string) => ["devices", deviceId, "settings"] as const,
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

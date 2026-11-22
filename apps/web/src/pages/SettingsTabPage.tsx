// 「設定」タブ。デバイスの一覧・セットアップと初回の手順・アカウント

import type { Device } from "@press-call/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CircleCheck } from "lucide-react";
import { ErrorAlert, Loading, Page, Steps } from "@/components/layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "../api/client";
import { connectedDeviceLabels, splitDevices } from "../devices";
import { formatDateTime } from "../format";
import { errorMessage } from "../messages";
import { devicesQuery } from "../queries";

const authRoute = getRouteApi("/auth");

export function SettingsTabPage() {
  const { me } = authRoute.useRouteContext();
  const devices = useQuery(devicesQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const onLogout = () => {
    void api.logout().finally(() => {
      queryClient.clear();
      void navigate({ to: "/login", search: { reason: "logged_out" }, replace: true });
    });
  };

  const connected = devices.data ? connectedDeviceLabels(devices.data) : [];
  const { usable, revoked } = splitDevices(devices.data ?? []);

  return (
    <Page title="設定">
      <Card>
        <CardHeader>
          <CardTitle>デバイス</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ErrorAlert message={devices.error ? errorMessage(devices.error) : null} />
          {devices.isPending && <Loading />}
          {devices.data && usable.length === 0 && (
            <p className="text-muted-foreground">
              {revoked.length === 0 ? "まだデバイスがありません。" : "使えるデバイスがありません。"}
              下の手順でデバイスを追加してください。
            </p>
          )}
        </CardContent>
        {usable.length > 0 && <DeviceRows devices={usable} />}
        {revoked.length > 0 && (
          // 失効済みのデバイスは、ふだんは畳んでおく（ペアリングし直すたびに増えるため）
          <details className="group border-t border-border/70 first:border-t-0">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-2 text-sm text-muted-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              失効済みのデバイス（{revoked.length}）
              <ChevronDown
                className="size-5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </summary>
            <DeviceRows devices={revoked} />
          </details>
        )}
      </Card>

      {/* テザリングは毎回必要なので、初回だけの手順とは分けて先に書く */}
      <Card>
        <CardHeader>
          <CardTitle>セットアップ</CardTitle>
          <CardDescription>
            デバイスは iPhone
            のテザリングを通して記録を送ります。使うたびに次の手順でつないでください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Steps>
            <li>iPhone の「設定」アプリを開き、「インターネット共有」を押す</li>
            <li>「ほかの人の接続を許可」をオンにする</li>
            <li>
              「互換性を優先」をオンにする（デバイスは 2.4GHz の Wi-Fi にしかつながらないため）
            </li>
            <li>
              デバイスの電源を入れる。つながるまで「インターネット共有」の画面を開いたままにしておく
            </li>
          </Steps>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>初めて使う場合</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {connected.length > 0 && (
            <Alert className="bg-success/10">
              <CircleCheck className="text-success" aria-hidden />
              <AlertTitle>接続済みのデバイスがあります</AlertTitle>
              <AlertDescription>
                <p>このまま使うなら、追加し直す必要はありません。</p>
                <ul className="list-disc pl-5">
                  {connected.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <Steps>
            <li>上のセットアップで、デバイスをテザリングにつなぐ</li>
            <li>
              {/* bench.local はデバイスが出すページ。この画面を残したまま別のタブで開く */}
              <a
                href="http://bench.local"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary underline underline-offset-4"
              >
                http://bench.local
              </a>{" "}
              を開き、「Web アプリで許可する」を押す
            </li>
          </Steps>
          <p className="text-sm text-muted-foreground">
            bench.local が開けないときは、そこに表示されるコードを
            <Link to="/devices/pair" className="text-primary underline underline-offset-4">
              ここで入力
            </Link>
            して許可することもできます。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>アカウント</CardTitle>
          <CardDescription className="truncate">
            {me.displayName ?? me.email} でログイン中
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="w-full" onClick={onLogout}>
            ログアウト
          </Button>
        </CardContent>
      </Card>
    </Page>
  );
}

/** デバイスの行。iOS の設定アプリのように、行全体を押すとそのデバイスの画面へ進む */
function DeviceRows(props: { devices: Device[] }) {
  return (
    <ul className="divide-y divide-border/70">
      {props.devices.map((d) => (
        <li key={d.id}>
          <Link
            to="/devices/$deviceId/settings"
            params={{ deviceId: d.id }}
            className="flex min-h-15 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-accent active:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{d.name}</span>
                {!d.active && <Badge variant="outline">失効済み</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">
                最終通信：{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : "まだありません"}
              </div>
            </div>
            <span className="sr-only">の設定を開く</span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

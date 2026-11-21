// ペアリングの許可画面（/devices/pair?code=BCDF-GHJK）。API 仕様書 4 章
// bench.local の「Web アプリで許可する」から、コード入力済みで開かれる
import { normalizeUserCode } from "@press-call/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ErrorAlert, Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/client";
import { errorMessage } from "../messages";
import { queryKeys } from "../queries";

const route = getRouteApi("/auth/devices/pair");

type Action = "approve" | "deny";

export function PairPage() {
  const search = route.useSearch();
  const [code, setCode] = useState(search.code ?? "");
  const [name, setName] = useState("部室のデバイス");
  const queryClient = useQueryClient();

  const pairing = useMutation({
    mutationFn: async (action: Action) => {
      if (action === "approve") {
        const { data } = await api.json<{ deviceId: string }>("/pairings/approve", {
          method: "POST",
          body: JSON.stringify({ userCode: code, deviceName: name }),
        });
        return { action, deviceId: data.deviceId };
      }
      await api.request("/pairings/deny", {
        method: "POST",
        body: JSON.stringify({ userCode: code }),
      });
      return { action, deviceId: null };
    },
    // 一覧に新しいデバイスを出す
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.devices }),
  });

  const done = pairing.data;
  if (done?.action === "approve" && done.deviceId) {
    return (
      <Page title="許可しました" back="/settings">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-success" aria-hidden />
              デバイスを追加しました
            </CardTitle>
            <CardDescription>
              数秒でデバイスに反映されます。bench.local
              のタブに戻り、「ペアリング済み」と出ていれば使えます。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary" className="w-full">
              <Link to="/devices/$deviceId/settings" params={{ deviceId: done.deviceId }}>
                このデバイスの設定を開く
              </Link>
            </Button>
          </CardContent>
        </Card>
      </Page>
    );
  }
  if (done?.action === "deny") {
    return (
      <Page title="拒否しました" back="/settings">
        <p className="text-muted-foreground">このコードのデバイスは登録されません。</p>
      </Page>
    );
  }

  const codeOk = normalizeUserCode(code) !== null;
  const busy = pairing.isPending;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    pairing.mutate("approve");
  };

  return (
    <Page title="デバイスを追加" back="/settings">
      <Card>
        <CardHeader>
          <CardDescription>
            デバイスの画面（bench.local）に出ているコードと同じか確かめてから、許可してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="user-code">コード</Label>
              <Input
                id="user-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="BCDF-GHJK"
                autoCapitalize="characters"
                autoComplete="off"
                className="h-13 text-center font-mono text-xl tracking-[0.2em] uppercase"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-name">デバイスの名前</Label>
              <Input
                id="device-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
              />
            </div>
            <ErrorAlert message={pairing.error ? errorMessage(pairing.error) : null} />
            {/* 縦に並べ、いちばん押してほしい「許可する」を目立たせる */}
            <div className="flex flex-col gap-2">
              <Button type="submit" size="lg" disabled={busy || !codeOk || !name.trim()}>
                許可する
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy || !codeOk}
                onClick={() => pairing.mutate("deny")}
              >
                身に覚えがない（拒否）
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </Page>
  );
}

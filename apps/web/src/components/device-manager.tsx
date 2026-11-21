// デバイスの管理（FR-A04）：名前の変更と、盗難・紛失時の失効。デバイスの設定画面で使う
import { type Device, deviceNameSchema } from "@press-call/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Pencil, ShieldOff } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorAlert } from "@/components/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../api/client";
import { formatDateTime } from "../format";
import { errorMessage } from "../messages";
import { queryKeys } from "../queries";

/**
 * デバイスの名前と状態。名前はふだんは表示だけにし、「編集」を押したときだけ入力欄にする
 */
export function DeviceInfoCard(props: { device: Device }) {
  const { device } = props;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (newName: string) =>
      (
        await api.json<Device>(`/devices/${device.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: newName }),
        })
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      setEditing(false);
      setJustSaved(true);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // API と同じルール（前後の空白を落として 1〜50 文字）で確かめる
    const result = deviceNameSchema.safeParse(name);
    if (!result.success) {
      setFieldError("1〜50 文字で入力してください");
      return;
    }
    setFieldError(null);
    save.mutate(result.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>デバイス</CardTitle>
        {!editing && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="-my-2 -mr-3 h-11"
              onClick={() => {
                setName(device.name);
                setFieldError(null);
                setJustSaved(false);
                save.reset();
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
              名前を変える
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editing ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-name">名前</Label>
              <Input
                id="device-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                aria-invalid={fieldError ? true : undefined}
              />
              {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}
            </div>
            <ErrorAlert message={save.error ? errorMessage(save.error) : null} />
            <Button
              type="submit"
              className="w-full"
              disabled={save.isPending || name.trim() === device.name}
            >
              {save.isPending ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="-mt-2 w-full"
              disabled={save.isPending}
              onClick={() => setEditing(false)}
            >
              キャンセル
            </Button>
          </form>
        ) : (
          <dl className="divide-y divide-border/70">
            <InfoRow label="名前">
              <span className="font-semibold">{device.name}</span>
            </InfoRow>
            <InfoRow label="状態">
              {device.active ? (
                <Badge className="bg-success/15 text-success">使える</Badge>
              ) : (
                <Badge variant="outline">使えない（失効済み）</Badge>
              )}
            </InfoRow>
            <InfoRow label="最終通信">
              {device.lastSeenAt ? formatDateTime(device.lastSeenAt) : "まだありません"}
            </InfoRow>
            <InfoRow label="追加した日">{formatDateTime(device.createdAt)}</InfoRow>
          </dl>
        )}
        {justSaved && !editing && (
          <Alert className="bg-success/10" role="status">
            <CircleCheck className="text-success" aria-hidden />
            <AlertDescription>名前を変えました。</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 truncate text-right">{props.children}</dd>
    </div>
  );
}

/**
 * デバイスを使えなくする（盗難・紛失時）。押すと確認を出してから失効させる。
 * 記録は消えない。また使うにはペアリングし直す
 */
export function RevokeDeviceCard(props: { device: Device }) {
  const { device } = props;
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: () => api.request(`/devices/${device.id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
    },
  });

  if (!device.active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>このデバイスは使えません</CardTitle>
          <CardDescription>
            失効済みのため、記録を送れません。これまでの記録は残っています。また使うときは、設定タブの「初めて使う場合」の手順でペアリングし直してください。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <ErrorAlert message={revoke.error ? errorMessage(revoke.error) : null} />
        {confirming ? (
          <>
            <p className="text-sm">
              「{device.name}」から記録を送れなくします。これまでの記録は残ります。
              <strong>また使うにはペアリングし直す必要があります。</strong>
            </p>
            <Button
              variant="destructive"
              className="w-full"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              {revoke.isPending ? "処理中…" : "使えなくする"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={revoke.isPending}
              onClick={() => setConfirming(false)}
            >
              やめる
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="w-full text-destructive"
              onClick={() => setConfirming(true)}
            >
              <ShieldOff aria-hidden />
              このデバイスを使えなくする
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              盗まれた・なくしたときに使います
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

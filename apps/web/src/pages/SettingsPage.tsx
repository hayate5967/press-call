// デバイスの画面（/devices/{id}/settings）。API 仕様書 6 章
// - いちばん上：名前（変更できる）と状態（FR-A04）
// - 設定（FR-V06）：保存は If-Match に読み込んだときの version を付け、別の画面での変更を上書きしない
// - いちばん下：盗難・紛失時に使えなくする（失効、FR-A04）
import type { DeviceSettingsDetail } from "@press-call/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { DeviceInfoCard, RevokeDeviceCard } from "@/components/device-manager";
import { ErrorAlert, Loading, Page } from "@/components/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ApiProblem, api } from "../api/client";
import { formatDateTime } from "../format";
import { errorMessage } from "../messages";
import { deviceSettingsQuery, devicesQuery, queryKeys } from "../queries";
import { fromForm, type SettingsForm, toForm } from "../settings-form";

const route = getRouteApi("/auth/devices/$deviceId/settings");

export function SettingsPage() {
  const { deviceId } = route.useParams();
  const settings = useQuery(deviceSettingsQuery(deviceId));
  const devices = useQuery(devicesQuery);
  const device = devices.data?.find((d) => d.id === deviceId);
  const [saved, setSaved] = useState(false);

  return (
    <Page title={device?.name ?? "デバイス"} back="/settings">
      {device && <DeviceInfoCard device={device} />}
      {settings.isPending && <Loading />}
      <ErrorAlert message={settings.error ? errorMessage(settings.error) : null} />
      {settings.data && (
        // 読み直して version が変わったら（保存した・別の画面で変わった）、フォームを最新の値に作り直す
        <SettingsEditor
          key={settings.data.version}
          deviceId={deviceId}
          loaded={settings.data}
          saved={saved}
          onSaved={setSaved}
        />
      )}
      {device && <RevokeDeviceCard device={device} />}
    </Page>
  );
}

function SettingsEditor(props: {
  deviceId: string;
  loaded: DeviceSettingsDetail;
  saved: boolean;
  onSaved: (saved: boolean) => void;
}) {
  const { deviceId, loaded, onSaved } = props;
  const [form, setForm] = useState<SettingsForm>(() => toForm(loaded));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof SettingsForm, string>>>({});
  const queryClient = useQueryClient();
  const queryKey = queryKeys.deviceSettings(deviceId);

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      (
        await api.json<DeviceSettingsDetail>(`/devices/${deviceId}/settings`, {
          method: "PUT",
          headers: { "If-Match": `"${loaded.version}"` },
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      onSaved(true);
    },
    onError: (err) => {
      // 別の画面で変わっていたら、最新を読み直して見せる
      if (err instanceof ApiProblem && err.code === "precondition_failed") {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const set = (patch: Partial<SettingsForm>) => {
    setForm({ ...form, ...patch });
    onSaved(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = fromForm(form);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    save.mutate(result.input);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h2 className="px-1 pt-2 text-sm font-semibold text-muted-foreground">合図の設定</h2>
      <Card>
        <CardHeader>
          <CardTitle>モード</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            className="gap-1"
            value={form.mode}
            onValueChange={(mode) => set({ mode: mode as SettingsForm["mode"] })}
          >
            <Choice value="auto_signal" id="mode-auto">
              自動合図（胸の上で止まったら「Press」）
            </Choice>
            <Choice value="count_only" id="mode-count">
              回数記録だけ（合図なし）
            </Choice>
          </RadioGroup>
        </CardContent>
      </Card>

      {form.mode === "auto_signal" && (
        <Card>
          <CardHeader>
            <CardTitle>静止してから合図までの時間</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RadioGroup
              className="gap-1"
              value={form.pauseMode}
              onValueChange={(pauseMode) =>
                set({ pauseMode: pauseMode as SettingsForm["pauseMode"] })
              }
            >
              <Choice value="fixed" id="pause-fixed">
                固定
              </Choice>
              <Choice value="random" id="pause-random">
                ランダム（試合の合図に慣れる練習）
              </Choice>
            </RadioGroup>
            {form.pauseMode === "fixed" ? (
              <SecondsInput
                id="fixed-sec"
                label="秒"
                value={form.fixedSec}
                error={fieldErrors.fixedSec}
                onChange={(fixedSec) => set({ fixedSec })}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <SecondsInput
                  id="min-sec"
                  label="最短（秒）"
                  value={form.minSec}
                  error={fieldErrors.minSec}
                  onChange={(minSec) => set({ minSec })}
                />
                <SecondsInput
                  id="max-sec"
                  label="最長（秒）"
                  value={form.maxSec}
                  error={fieldErrors.maxSec}
                  onChange={(maxSec) => set({ maxSec })}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>静止とみなす速さ（上級者向け）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Label htmlFor="still-threshold">m/s（空欄ならデバイスの既定値）</Label>
            <Input
              id="still-threshold"
              inputMode="decimal"
              value={form.stillThreshold}
              onChange={(e) => set({ stillThreshold: e.target.value })}
              placeholder="既定値"
              aria-invalid={fieldErrors.stillThreshold ? true : undefined}
            />
            <FieldError message={fieldErrors.stillThreshold} />
          </div>
        </CardContent>
      </Card>

      <ErrorAlert message={save.error ? errorMessage(save.error) : null} />
      {props.saved && (
        <Alert className="bg-success/10" role="status">
          <CircleCheck className="text-success" aria-hidden />
          <AlertDescription>
            保存しました。デバイスには次のセットの前に反映されます。
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
        保存
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        version {loaded.version}・更新 {formatDateTime(loaded.updatedAt)}
      </p>
    </form>
  );
}

function Choice(props: { value: string; id: string; children: ReactNode }) {
  // 丸だけでなく文字を含めた行全体（高さ 44px 以上）を押せるようにする
  return (
    <Label
      htmlFor={props.id}
      className="flex min-h-11 items-center gap-3 text-base leading-snug font-normal"
    >
      <RadioGroupItem value={props.value} id={props.id} />
      {props.children}
    </Label>
  );
}

function SecondsInput(props: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        inputMode="decimal"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
      />
      <FieldError message={props.error} />
    </div>
  );
}

function FieldError(props: { message: string | undefined }) {
  if (!props.message) return null;
  return <p className="text-sm text-destructive">{props.message}</p>;
}

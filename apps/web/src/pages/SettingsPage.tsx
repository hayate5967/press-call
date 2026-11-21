// デバイスの画面（/devices/{id}/settings）。API 仕様書 6 章
// - いちばん上：名前（変更できる）と状態（FR-A04）
// - 設定（FR-V06）：保存は If-Match に読み込んだときの version を付け、別の画面での変更を上書きしない
// - いちばん下：盗難・紛失時に使えなくする（失効、FR-A04）
import type { DeviceSettingsDetail } from "@press-call/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { DeviceInfoCard, RevokeDeviceCard } from "@/components/device-manager";
import { ErrorAlert, Loading, Page } from "@/components/layout";
import { SignalSettingsFields } from "@/components/signal-settings-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      {/* 今日タブのシートと同じ入力欄（signal-settings-fields.tsx） */}
      <Card>
        <CardContent>
          <SignalSettingsFields idPrefix="device" form={form} errors={fieldErrors} onChange={set} />
        </CardContent>
      </Card>

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

function FieldError(props: { message: string | undefined }) {
  if (!props.message) return null;
  return <p className="text-sm text-destructive">{props.message}</p>;
}

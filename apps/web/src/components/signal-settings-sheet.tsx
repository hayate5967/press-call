// 合図の設定を下からせり上がるシートで変える（今日タブの開始・終了ボタンの上から開く）
//
// デバイスの画面の設定と同じ API（PUT /devices/{id}/settings、If-Match つき）を使う。
// 入力欄はデバイスの画面と同じ部品（signal-settings-fields.tsx）。
// 静止とみなす速さ（上級者向け）はここでは変えず、今の値のまま送る
import type { Device, DeviceSettingsDetail } from "@press-call/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ErrorAlert, Loading } from "@/components/layout";
import { SignalSettingsFields } from "@/components/signal-settings-fields";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { ApiProblem, api } from "../api/client";
import { errorMessage } from "../messages";
import { deviceSettingsQuery, queryKeys } from "../queries";
import { fromForm, type SettingsForm, settingsSummary, toForm } from "../settings-form";

export function SignalSettingsSheet(props: { device: Device; recording: boolean }) {
  const { device } = props;
  const settings = useQuery(deviceSettingsQuery(device.id));
  const [open, setOpen] = useState(false);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-full px-4 text-left active:bg-accent"
        >
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">合図の設定</span>
            <span className="block truncate text-sm font-semibold">
              {settings.data ? settingsSummary(settings.data) : "読み込み中…"}
            </span>
          </span>
          <ChevronUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>合図の設定</DrawerTitle>
          <DrawerDescription>
            {props.recording
              ? "記録中のセットには使われません。次のセットから使われます。"
              : "デバイスには数秒で伝わります。"}
          </DrawerDescription>
        </DrawerHeader>
        {settings.isPending && (
          <div className="px-5 pb-6">
            <Loading />
          </div>
        )}
        <div className="px-5">
          <ErrorAlert message={settings.error ? errorMessage(settings.error) : null} />
        </div>
        {settings.data && (
          // 読み直して version が変わったら（別の画面で変わった）、最新の値で作り直す
          <SettingsSheetForm
            key={settings.data.version}
            deviceId={device.id}
            loaded={settings.data}
            onSaved={() => setOpen(false)}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SettingsSheetForm(props: {
  deviceId: string;
  loaded: DeviceSettingsDetail;
  onSaved: () => void;
}) {
  const { deviceId, loaded } = props;
  const queryClient = useQueryClient();
  const queryKey = queryKeys.deviceSettings(deviceId);
  const [form, setForm] = useState<SettingsForm>(() => toForm(loaded));
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsForm, string>>>({});

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
      props.onSaved();
    },
    onError: (err) => {
      // 別の画面で変わっていたら、最新を読み直して見せる
      if (err instanceof ApiProblem && err.code === "precondition_failed") {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const set = (patch: Partial<SettingsForm>) => setForm({ ...form, ...patch });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = fromForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.input);
  };

  const unchanged = JSON.stringify(fromForm(form)) === JSON.stringify(fromForm(toForm(loaded)));

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
      <div className="overflow-y-auto px-5 pb-2">
        <SignalSettingsFields idPrefix="sheet" form={form} errors={errors} onChange={set} />
      </div>
      <DrawerFooter>
        <ErrorAlert message={save.error ? errorMessage(save.error) : null} />
        <Button type="submit" size="lg" className="w-full" disabled={unchanged || save.isPending}>
          {save.isPending ? "保存中…" : "保存"}
        </Button>
      </DrawerFooter>
    </form>
  );
}

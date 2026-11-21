// 合図の設定を下からせり上がるシートで変える（今日タブの開始・終了ボタンの上から開く）
//
// デバイスの画面の設定と同じ API（PUT /devices/{id}/settings、If-Match つき）を使う。
// 練習中に片手で変えられるよう、モードは大きなボタン、秒は「− / ＋」で 0.1 秒ずつ動かす。
// 静止とみなす速さ（上級者向け）はここでは変えず、今の値のまま送る
import type { Device, DeviceSettingsDetail } from "@press-call/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, Minus, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorAlert, Loading } from "@/components/layout";
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
import { cn } from "@/lib/utils";
import { ApiProblem, api } from "../api/client";
import { errorMessage } from "../messages";
import { deviceSettingsQuery, queryKeys } from "../queries";
import {
  fromForm,
  type SettingsForm,
  settingsSummary,
  stepSeconds,
  toForm,
} from "../settings-form";

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
      <div className="flex flex-col overflow-y-auto px-5 pb-2">
        <Choices
          legend="モード"
          value={form.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "auto_signal", label: "自動合図", note: "止まったら Press" },
            { value: "count_only", label: "回数記録", note: "合図なし" },
          ]}
        />

        {/* モードや待ち時間の種類を切り替えたとき、出る・消える部分の高さをなめらかに変える
            （シートの高さも一緒に伸び縮みする）。消えている部分は押せないようにする */}
        <Collapse open={form.mode === "auto_signal"}>
          <div className="flex flex-col pt-5">
            <Choices
              legend="静止してから合図までの時間"
              value={form.pauseMode}
              onChange={(pauseMode) => set({ pauseMode })}
              options={[
                { value: "fixed", label: "固定", note: "毎回同じ" },
                { value: "random", label: "ランダム", note: "試合の練習" },
              ]}
            />
            <Collapse open={form.pauseMode === "fixed"}>
              <div className="pt-5">
                <SecondsStepper
                  label="待ち時間"
                  value={form.fixedSec}
                  error={errors.fixedSec}
                  onChange={(fixedSec) => set({ fixedSec })}
                />
              </div>
            </Collapse>
            <Collapse open={form.pauseMode === "random"}>
              <div className="flex flex-col gap-3 pt-5">
                <SecondsStepper
                  label="最短"
                  value={form.minSec}
                  error={errors.minSec}
                  onChange={(minSec) => set({ minSec })}
                />
                <SecondsStepper
                  label="最長"
                  value={form.maxSec}
                  error={errors.maxSec}
                  onChange={(maxSec) => set({ maxSec })}
                />
              </div>
            </Collapse>
          </div>
        </Collapse>
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

/** 2 つから選ぶ大きなボタン */
function Choices<T extends string>(props: {
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; note: string }[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{props.legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {props.options.map((o) => {
          const on = o.value === props.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => props.onChange(o.value)}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center rounded-md px-2 py-2 transition-colors active:scale-[0.98]",
                on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
              )}
            >
              <span className="font-semibold">{o.label}</span>
              <span className={cn("text-xs", on ? "opacity-90" : "text-muted-foreground")}>
                {o.note}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 秒を「− / ＋」で 0.1 秒ずつ動かす（数字を直接打つこともできる） */
function SecondsStepper(props: {
  label: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const id = `sec-${props.label}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <div className="flex items-center gap-3">
        <StepButton
          label={`${props.label}を 0.1 秒短く`}
          onClick={() => props.onChange(stepSeconds(props.value, -0.1))}
        >
          <Minus />
        </StepButton>
        <div className="flex flex-1 items-baseline justify-center gap-1 rounded-md bg-secondary py-1.5">
          <input
            id={id}
            inputMode="decimal"
            value={props.value}
            onChange={(e) => props.onChange(e.target.value)}
            aria-invalid={props.error ? true : undefined}
            className="w-20 bg-transparent text-center text-3xl font-semibold outline-none"
          />
          <span className="text-sm text-muted-foreground">秒</span>
        </div>
        <StepButton
          label={`${props.label}を 0.1 秒長く`}
          onClick={() => props.onChange(stepSeconds(props.value, 0.1))}
        >
          <Plus />
        </StepButton>
      </div>
      {props.error && <p className="text-sm text-destructive">{props.error}</p>}
    </div>
  );
}

function StepButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-lg"
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/**
 * 中身の高さに合わせて、なめらかに開いたり閉じたりする（grid の行の高さ 0fr ⇔ 1fr を動かす）。
 * 「動きを減らす」設定なら動かさずに切り替える。閉じているあいだは中身を押せず、読み上げもしない
 */
function Collapse(props: { open: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!props.open}
      inert={!props.open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        props.open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{props.children}</div>
    </div>
  );
}

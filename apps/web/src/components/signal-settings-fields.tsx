// 合図の設定の入力欄（モード・待ち時間）。今日タブのシートとデバイスの画面で同じものを使い、見た目と動きをそろえる
//
// 練習中に片手で変えられるよう、モードは大きな 2 択のボタン、秒は「− / ＋」で 0.1 秒ずつ動かす。
// モードや待ち時間の種類を切り替えたとき、出る・消える部分の高さはなめらかに変える
import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type SettingsForm, stepSeconds } from "../settings-form";

export function SignalSettingsFields(props: {
  /** 入力欄の id の頭（同じ画面に 2 つ出ても id がぶつからないように） */
  idPrefix: string;
  form: SettingsForm;
  errors: Partial<Record<keyof SettingsForm, string>>;
  onChange: (patch: Partial<SettingsForm>) => void;
}) {
  const { form, errors, onChange: set, idPrefix } = props;
  return (
    <div className="flex flex-col">
      <Choices
        legend="モード"
        value={form.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "auto_signal", label: "自動合図", note: "止まったら Press" },
          { value: "count_only", label: "回数記録", note: "合図なし" },
        ]}
      />
      {/* 消えている部分は押せないようにする */}
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
                id={`${idPrefix}-fixed`}
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
                id={`${idPrefix}-min`}
                label="最短"
                value={form.minSec}
                error={errors.minSec}
                onChange={(minSec) => set({ minSec })}
              />
              <SecondsStepper
                id={`${idPrefix}-max`}
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
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  const id = props.id;
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

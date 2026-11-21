// セットの記録の入力（重量・RPE・メモ、FR-V04）と削除（FR-V05）。セットの詳細画面で使う
import type { SetDetail } from "@press-call/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ErrorAlert } from "@/components/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  fromSetForm,
  isSetFormChanged,
  parseWeight,
  rpeChoices,
  type SetForm,
  toSetForm,
} from "@/lib/set-form";
import { cn } from "@/lib/utils";
import { api } from "../api/client";
import { errorMessage } from "../messages";
import { queryKeys } from "../queries";

/** 重量のボタンで増やす・減らす量（プレートの片側 1.25kg × 2） */
const WEIGHT_STEP = 2.5;

/**
 * 重量・RPE・メモ。
 * - まだ何も入れていなければ、最初から入力欄を出す（セットの直後に片手で入れられるよう、重量は ± ボタン、RPE はボタン）
 * - 入れてあれば値を表示するだけにし、「編集」を押したときだけ入力欄にする
 * 保存すると練習日の一覧などの表示も新しくする
 */
export function SetRecordCard(props: { set: SetDetail }) {
  const { set } = props;
  const queryClient = useQueryClient();
  const saved = toSetForm(set);
  const [form, setForm] = useState<SetForm>(saved);
  const [errors, setErrors] = useState<Partial<Record<keyof SetForm, string>>>({});
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const hasRecord = set.weightKg !== null || set.rpe !== null || set.note !== null;

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      (
        await api.json<SetDetail>(`/sets/${set.id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        })
      ).data,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.set(set.id), data);
      // 今日タブ・練習日の画面のカードにも重量を出しているので読み直す
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      setForm(toSetForm(data));
      setJustSaved(true);
      setEditing(false);
    },
  });

  const update = (patch: Partial<SetForm>) => {
    setForm({ ...form, ...patch });
    setJustSaved(false);
  };

  const stepWeight = (delta: number) => {
    const current = parseWeight(form.weight);
    const base = current === null || Number.isNaN(current) ? 0 : current;
    update({ weight: String(Math.min(500, Math.max(0, base + delta))) });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = fromSetForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.input);
  };

  const changed = isSetFormChanged(saved, form);

  if (hasRecord && !editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>記録</CardTitle>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="-my-2 -mr-3 h-11"
              onClick={() => {
                setForm(saved);
                setErrors({});
                setJustSaved(false);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden />
              編集
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-secondary px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">重量</dt>
              <dd className="text-3xl font-semibold">
                {set.weightKg === null ? (
                  <span className="text-lg text-muted-foreground">未入力</span>
                ) : (
                  <>
                    {set.weightKg}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">kg</span>
                  </>
                )}
              </dd>
            </div>
            <div className="rounded-md bg-secondary px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">RPE</dt>
              <dd className="text-3xl font-semibold">
                {set.rpe ?? <span className="text-lg text-muted-foreground">未入力</span>}
              </dd>
            </div>
            {set.note && (
              <div className="col-span-2 rounded-md bg-secondary px-3 py-2.5">
                <dt className="text-xs text-muted-foreground">メモ</dt>
                <dd className="whitespace-pre-wrap">{set.note}</dd>
              </div>
            )}
          </dl>
          {justSaved && (
            <Alert className="bg-success/10" role="status">
              <CircleCheck className="text-success" aria-hidden />
              <AlertDescription>保存しました。</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasRecord ? "記録を編集" : "記録"}</CardTitle>
        <CardDescription>重量・RPE・メモはセットのあとに入れてください</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="weight">重量（kg）</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={`${WEIGHT_STEP} kg 減らす`}
                onClick={() => stepWeight(-WEIGHT_STEP)}
              >
                <Minus />
              </Button>
              <Input
                id="weight"
                inputMode="decimal"
                value={form.weight}
                onChange={(e) => update({ weight: e.target.value })}
                placeholder="未入力"
                aria-invalid={errors.weight ? true : undefined}
                className="h-12 text-center text-2xl font-semibold"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={`${WEIGHT_STEP} kg 増やす`}
                onClick={() => stepWeight(WEIGHT_STEP)}
              >
                <Plus />
              </Button>
            </div>
            <FieldError message={errors.weight} />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">RPE（きつさ。10 が限界）</legend>
            <div className="grid grid-cols-5 gap-2">
              {rpeChoices(form.rpe).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={form.rpe === v}
                  onClick={() => update({ rpe: form.rpe === v ? null : v })}
                  className={cn(
                    "h-11 rounded-full text-base font-semibold tabular-nums transition-colors active:scale-95",
                    form.rpe === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={form.rpe === null}
                onClick={() => update({ rpe: null })}
                className={cn(
                  "h-11 rounded-full text-sm font-semibold transition-colors active:scale-95",
                  form.rpe === null
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                なし
              </button>
            </div>
            <FieldError message={errors.rpe} />
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="note">メモ</Label>
            <textarea
              id="note"
              value={form.note}
              onChange={(e) => update({ note: e.target.value })}
              maxLength={500}
              rows={3}
              placeholder="例：2 レップ目で少し波打った"
              aria-invalid={errors.note ? true : undefined}
              className="w-full rounded-md border border-transparent bg-secondary px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/25"
            />
            <FieldError message={errors.note} />
          </div>

          <ErrorAlert message={save.error ? errorMessage(save.error) : null} />
          <Button type="submit" size="lg" className="w-full" disabled={!changed || save.isPending}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
          {/* 入れてある記録を編集しているときは、保存せずに表示へ戻れる */}
          {hasRecord && (
            <Button
              type="button"
              variant="ghost"
              className="-mt-3 w-full"
              disabled={save.isPending}
              onClick={() => {
                setForm(saved);
                setErrors({});
                save.reset();
                setEditing(false);
              }}
            >
              キャンセル
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError(props: { message: string | undefined }) {
  if (!props.message) return null;
  return <p className="text-sm text-destructive">{props.message}</p>;
}

/**
 * セットの削除。誤って消さないよう、押すと確認を出してから消す。
 * 消したセットは元に戻せない（デバイスから同じセットが再送されても復活しない）
 */
export function DeleteSetCard(props: { setId: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.request(`/sets/${props.setId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.set(props.setId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      props.onDeleted();
    },
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <ErrorAlert message={remove.error ? errorMessage(remove.error) : null} />
        {confirming ? (
          <>
            <p className="text-sm">
              このセットとレップの記録を削除します。<strong>元に戻せません。</strong>
            </p>
            <Button
              variant="destructive"
              className="w-full"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "削除中…" : "削除する"}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
            >
              やめる
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            className="w-full text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden />
            このセットを削除
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// デバイスの設定画面（/devices/{id}/settings）。API 仕様書 6 章
// 保存は If-Match に読み込んだときの version を付け、別の画面での変更を上書きしない
import type { DeviceSettingsDetail } from "@press-call/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "../api/client";
import { ErrorText, Page } from "../components";
import { formatDateTime } from "../format";
import { errorMessage } from "../messages";
import { fromForm, type SettingsForm, toForm } from "../settings-form";

export function SettingsPage(props: { deviceId: string; onError: (err: unknown) => void }) {
  const { deviceId, onError } = props;
  const [loaded, setLoaded] = useState<DeviceSettingsDetail | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof SettingsForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.json<DeviceSettingsDetail>(`/devices/${deviceId}/settings`);
    setLoaded(data);
    setForm(toForm(data));
  }, [deviceId]);

  useEffect(() => {
    load().catch((err: unknown) => {
      setError(errorMessage(err));
      onError(err);
    });
  }, [load, onError]);

  if (!form || !loaded) {
    return (
      <Page title="設定" back="/">
        <ErrorText message={error} />
        {!error && <p className="muted">読み込み中…</p>}
      </Page>
    );
  }

  const set = (patch: Partial<SettingsForm>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || !loaded) return;
    const result = fromForm(form);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      const { data } = await api.json<DeviceSettingsDetail>(`/devices/${deviceId}/settings`, {
        method: "PUT",
        headers: { "If-Match": `"${loaded.version}"` },
        body: JSON.stringify(result.input),
      });
      setLoaded(data);
      setForm(toForm(data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
      // 別の画面で変わっていたら、最新を読み直して見せる
      if (err instanceof ApiProblem && err.code === "precondition_failed") {
        await load().catch(() => {});
      }
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="設定" back="/">
      <form onSubmit={onSubmit} className="form">
        <fieldset>
          <legend>モード</legend>
          <label className="radio">
            <input
              type="radio"
              checked={form.mode === "auto_signal"}
              onChange={() => set({ mode: "auto_signal" })}
            />
            自動合図（胸の上で止まったら「Press」）
          </label>
          <label className="radio">
            <input
              type="radio"
              checked={form.mode === "count_only"}
              onChange={() => set({ mode: "count_only" })}
            />
            回数記録だけ（合図なし）
          </label>
        </fieldset>

        {form.mode === "auto_signal" && (
          <fieldset>
            <legend>静止してから合図までの時間</legend>
            <label className="radio">
              <input
                type="radio"
                checked={form.pauseMode === "fixed"}
                onChange={() => set({ pauseMode: "fixed" })}
              />
              固定
            </label>
            <label className="radio">
              <input
                type="radio"
                checked={form.pauseMode === "random"}
                onChange={() => set({ pauseMode: "random" })}
              />
              ランダム（試合の合図に慣れる練習）
            </label>
            {form.pauseMode === "fixed" ? (
              <SecondsInput
                label="秒"
                value={form.fixedSec}
                error={fieldErrors.fixedSec}
                onChange={(fixedSec) => set({ fixedSec })}
              />
            ) : (
              <div className="row">
                <SecondsInput
                  label="最短（秒）"
                  value={form.minSec}
                  error={fieldErrors.minSec}
                  onChange={(minSec) => set({ minSec })}
                />
                <SecondsInput
                  label="最長（秒）"
                  value={form.maxSec}
                  error={fieldErrors.maxSec}
                  onChange={(maxSec) => set({ maxSec })}
                />
              </div>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend>静止とみなす速さ（上級者向け）</legend>
          <label>
            m/s（空欄ならデバイスの既定値）
            <input
              inputMode="decimal"
              value={form.stillThreshold}
              onChange={(e) => set({ stillThreshold: e.target.value })}
              placeholder="既定値"
            />
          </label>
          <ErrorText message={fieldErrors.stillThreshold ?? null} />
        </fieldset>

        <ErrorText message={error} />
        {saved && (
          <p className="ok" role="status">
            保存しました。ベンチには次のセットの前に反映されます。
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          保存
        </button>
        <p className="muted small">
          version {loaded.version}・更新 {formatDateTime(loaded.updatedAt)}
        </p>
      </form>
    </Page>
  );
}

function SecondsInput(props: {
  label: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        inputMode="decimal"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <ErrorText message={props.error ?? null} />
    </label>
  );
}

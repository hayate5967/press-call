// ペアリングの許可画面（/devices/pair?code=BCDF-GHJK）。API 仕様書 4 章
// bench.local の「Web アプリで許可する」から、コード入力済みで開かれる
import { normalizeUserCode } from "@press-call/shared";
import { type FormEvent, useState } from "react";
import { api } from "../api/client";
import { ErrorText, Link, Page } from "../components";
import { errorMessage } from "../messages";

type Done = { kind: "approved"; deviceId: string } | { kind: "denied" };

export function PairPage(props: { search: string; onError: (err: unknown) => void }) {
  const [code, setCode] = useState(() => new URLSearchParams(props.search).get("code") ?? "");
  const [name, setName] = useState("部室のデバイス");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const codeOk = normalizeUserCode(code) !== null;

  async function send(action: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      if (action === "approve") {
        const { data } = await api.json<{ deviceId: string }>("/pairings/approve", {
          method: "POST",
          body: JSON.stringify({ userCode: code, deviceName: name }),
        });
        setDone({ kind: "approved", deviceId: data.deviceId });
      } else {
        await api.request("/pairings/deny", {
          method: "POST",
          body: JSON.stringify({ userCode: code }),
        });
        setDone({ kind: "denied" });
      }
    } catch (err) {
      setError(errorMessage(err));
      props.onError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done?.kind === "approved") {
    return (
      <Page title="許可しました" back="/">
        <p>
          数秒でデバイスに反映されます。bench.local
          のタブに戻り、「ペアリング済み」と出ていれば使えます。
        </p>
        <p>
          <Link to={`/devices/${done.deviceId}/settings`}>このデバイスの設定を開く</Link>
        </p>
      </Page>
    );
  }
  if (done?.kind === "denied") {
    return (
      <Page title="拒否しました" back="/">
        <p>このコードのデバイスは登録されません。</p>
      </Page>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send("approve");
  };

  return (
    <Page title="デバイスを追加" back="/">
      <p>デバイスの画面（bench.local）に出ているコードと同じか確かめてから、許可してください。</p>
      <form onSubmit={onSubmit} className="form">
        <label>
          コード
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="BCDF-GHJK"
            autoCapitalize="characters"
            autoComplete="off"
            className="code"
            required
          />
        </label>
        <label>
          デバイスの名前
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        </label>
        <ErrorText message={error} />
        <div className="buttons">
          <button type="submit" className="primary" disabled={busy || !codeOk || !name.trim()}>
            許可する
          </button>
          <button type="button" disabled={busy || !codeOk} onClick={() => void send("deny")}>
            身に覚えがない（拒否）
          </button>
        </div>
      </form>
    </Page>
  );
}

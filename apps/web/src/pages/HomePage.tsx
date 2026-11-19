// トップ画面。自分の情報とデバイスの一覧
import type { Device, Me } from "@press-call/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorText, Link, Page } from "../components";
import { formatDateTime } from "../format";
import { errorMessage } from "../messages";

export function HomePage(props: { me: Me; onError: (err: unknown) => void; onLogout: () => void }) {
  const { onError } = props;
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .json<{ items: Device[] }>("/devices")
      .then(({ data }) => setDevices(data.items))
      .catch((err: unknown) => {
        setError(errorMessage(err));
        onError(err);
      });
  }, [onError]);

  return (
    <Page title="press-call">
      <p className="muted">
        {props.me.displayName ?? props.me.email} でログイン中{" "}
        <button type="button" className="link" onClick={props.onLogout}>
          ログアウト
        </button>
      </p>

      <h2>デバイス</h2>
      <ErrorText message={error} />
      {devices === null && !error && <p className="muted">読み込み中…</p>}
      {devices?.length === 0 && (
        <p>まだデバイスがありません。下の手順でベンチを追加してください。</p>
      )}
      {devices && devices.length > 0 && (
        <ul className="list">
          {devices.map((d) => (
            <li key={d.id}>
              <div>
                <strong>{d.name}</strong>
                {!d.active && <span className="badge">無効</span>}
                <div className="muted small">
                  最終通信：{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : "まだありません"}
                </div>
              </div>
              <Link to={`/devices/${d.id}/settings`}>設定</Link>
            </li>
          ))}
        </ul>
      )}

      <h2>ベンチを追加する</h2>
      <ol className="steps">
        <li>iPhone のテザリングをオンにして、ベンチの電源を入れる</li>
        <li>
          Safari で <code>http://bench.local</code> を開き、「Web アプリで許可する」を押す
        </li>
        <li>
          または、ベンチに表示されたコードを<Link to="/devices/pair">ここで入力</Link>する
        </li>
      </ol>
    </Page>
  );
}

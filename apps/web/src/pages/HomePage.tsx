// トップ画面。自分の情報とデバイスの一覧
import type { Device, Me } from "@press-call/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ErrorText, Link, Page } from "../components";
import { connectedDeviceLabels } from "../devices";
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

  const connected = devices ? connectedDeviceLabels(devices) : [];

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
        <p>まだデバイスがありません。下の手順でデバイスを追加してください。</p>
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

      <h2>デバイスを追加する</h2>
      {connected.length > 0 && (
        <div className="notice">
          <p>接続済みのデバイスがあります。このまま使うなら、追加し直す必要はありません。</p>
          <ul>
            {connected.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
      <ol className="steps">
        <li>iPhone のテザリングをオンにして、デバイスの電源を入れる</li>
        <li>
          {/* bench.local はデバイスが出すページ。この画面を残したまま別のタブで開く */}
          <a href="http://bench.local" target="_blank" rel="noopener noreferrer">
            http://bench.local
          </a>{" "}
          を開き（新しいタブで開きます）、「Web アプリで許可する」を押す
          <div className="muted small">
            デバイスと同じテザリングにつながっているときだけ開けます
          </div>
        </li>
        <li>
          または、デバイスに表示されたコードを<Link to="/devices/pair">ここで入力</Link>する
        </li>
      </ol>
    </Page>
  );
}

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

      {/* テザリングは毎回必要なので、初回だけの手順とは分けて先に書く */}
      <h2>セットアップ</h2>
      <p>
        デバイスは iPhone のテザリングを通して記録を送ります。使うたびに次の手順でつないでください。
      </p>
      <ol className="steps">
        <li>iPhone の「設定」アプリを開き、「インターネット共有」を押す</li>
        <li>「ほかの人の接続を許可」をオンにする</li>
        <li>「互換性を優先」をオンにする（デバイスは 2.4GHz の Wi-Fi にしかつながらないため）</li>
        <li>
          デバイスの電源を入れる。つながるまで「インターネット共有」の画面を開いたままにしておく
        </li>
      </ol>

      <h2>初めて使う場合</h2>
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
        <li>上のセットアップで、デバイスをテザリングにつなぐ</li>
        <li>
          {/* bench.local はデバイスが出すページ。この画面を残したまま別のタブで開く */}
          <a href="http://bench.local" target="_blank" rel="noopener noreferrer">
            http://bench.local
          </a>{" "}
          を開き、「Web アプリで許可する」を押す
        </li>
      </ol>
      <p className="muted small">
        bench.local が開けないときは、そこに表示されるコードを
        <Link to="/devices/pair">ここで入力</Link>して許可することもできます。
      </p>
    </Page>
  );
}

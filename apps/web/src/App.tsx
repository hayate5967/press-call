// アプリの入口。ログイン状態を確かめ、URL に合った画面を出す
//
// 起動時：Cookie の rt で /auth/refresh → /me。成功したらログイン中、401 ならログイン画面へ。
// ログインが必要な画面にいたときは、その URL を覚えてからログイン画面へ移り、ログイン後に戻す
import type { Me } from "@press-call/shared";
import { useCallback, useEffect, useState } from "react";
import { AuthRequiredError, api } from "./api/client";
import { ErrorText, Page } from "./components";
import { errorMessage } from "./messages";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PairPage } from "./pages/PairPage";
import { SettingsPage } from "./pages/SettingsPage";
import { matchRoute, navigate, rememberReturnTo, takeReturnTo, useLocation } from "./router";

type Auth =
  | { status: "loading" }
  /** サーバや通信の一時的な問題でログイン状態を確かめられない（ログアウトはさせない） */
  | { status: "unavailable"; message: string }
  | { status: "anonymous"; notice: string | null }
  | { status: "signedIn"; me: Me };

export function App() {
  const loc = useLocation();
  const route = matchRoute(loc.pathname);
  const [auth, setAuth] = useState<Auth>({ status: "loading" });

  // 起動時（と「もう一度試す」のとき）に、ログインしているか確かめる
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt は「もう一度試す」の合図として使う
  useEffect(() => {
    let cancelled = false;
    api
      .refresh()
      .then(() => api.json<Me>("/me"))
      .then(({ data }) => {
        if (cancelled) return;
        setAuth({ status: "signedIn", me: data });
        // Google から戻ると / に着く。ログイン前にいた画面があればそこへ戻す
        const back = takeReturnTo();
        if (back && location.pathname === "/") navigate(back, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (!(err instanceof AuthRequiredError)) {
          // 503・通信失敗など。rt はまだ有効かもしれないので、ログイン画面には移さない
          setAuth({ status: "unavailable", message: errorMessage(err) });
          return;
        }
        const reused = err.reason === "refresh_token_reused";
        setAuth({ status: "anonymous", notice: reused ? errorMessage(err) : null });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // 画面の途中でログインが切れたら（リフレッシュも失敗したら）ログイン画面へ
  const onError = useCallback((err: unknown) => {
    if (err instanceof AuthRequiredError) {
      setAuth({ status: "anonymous", notice: errorMessage(err) });
    }
  }, []);

  const onLogout = useCallback(() => {
    void api.logout().finally(() => {
      setAuth({ status: "anonymous", notice: "ログアウトしました。" });
      navigate("/login", { replace: true });
    });
  }, []);

  // ログインしていないのにログインが必要な画面にいる → 覚えてからログイン画面へ
  useEffect(() => {
    if (auth.status === "anonymous" && route.name !== "login") {
      rememberReturnTo(loc.pathname + loc.search);
      navigate("/login", { replace: true });
    }
    if (auth.status === "signedIn" && route.name === "login") {
      navigate("/", { replace: true });
    }
  }, [auth.status, route.name, loc.pathname, loc.search]);

  if (auth.status === "loading") {
    return (
      <Page title="press-call">
        <p className="muted">読み込み中…</p>
      </Page>
    );
  }
  if (auth.status === "unavailable") {
    return (
      <Page title="press-call">
        <ErrorText message={auth.message} />
        <button
          type="button"
          onClick={() => {
            setAuth({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          もう一度試す
        </button>
      </Page>
    );
  }
  if (auth.status === "anonymous") {
    return <LoginPage search={loc.search} notice={auth.notice} />;
  }

  switch (route.name) {
    case "home":
    case "login":
      return <HomePage me={auth.me} onError={onError} onLogout={onLogout} />;
    case "pair":
      return <PairPage search={loc.search} onError={onError} />;
    case "settings":
      return <SettingsPage key={route.deviceId} deviceId={route.deviceId} onError={onError} />;
    case "notFound":
      return (
        <Page title="ページが見つかりません" back="/">
          <p>URL を確認してください。</p>
        </Page>
      );
  }
}

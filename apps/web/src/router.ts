// 画面の切り替え。画面が 4 つだけなので、ライブラリを使わず URL のパスで分ける
import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "login" }
  | { name: "pair" }
  | { name: "settings"; deviceId: string }
  | { name: "notFound" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/login") return { name: "login" };
  if (path === "/devices/pair") return { name: "pair" };
  const settings = /^\/devices\/([^/]+)\/settings$/.exec(path);
  if (settings?.[1] && UUID.test(settings[1])) return { name: "settings", deviceId: settings[1] };
  return { name: "notFound" };
}

const listeners = new Set<() => void>();

/** 画面を移る（ページは読み直さない） */
export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const l of listeners) l();
}

const readLocation = () => ({ pathname: location.pathname, search: location.search });

/** 今の URL（パスとクエリ）。戻る・進むでも更新される */
export function useLocation(): { pathname: string; search: string } {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    const update = () => setLoc(readLocation());
    listeners.add(update);
    addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      removeEventListener("popstate", update);
    };
  }, []);
  return loc;
}

// ---------- ログイン後に元の画面へ戻る ----------
// Google から戻ると必ず / に着くので、ログイン前にいた画面（例：コード入力済みのペアリング画面）を覚えておく

const RETURN_TO_KEY = "press-call:returnTo";

/**
 * 同じサイト内のパスだけを受け付ける。
 * "//evil.example" や "https://..." を通すと、ログイン後に外のサイトへ飛ばされてしまう（オープンリダイレクト）
 */
export function safeReturnTo(value: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

export function rememberReturnTo(path: string) {
  try {
    const safe = safeReturnTo(path);
    if (safe && safe !== "/login") sessionStorage.setItem(RETURN_TO_KEY, safe);
  } catch {
    // ストレージが使えなくても、ログインはできる（トップに戻るだけ）
  }
}

export function takeReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return safeReturnTo(value);
  } catch {
    return null;
  }
}

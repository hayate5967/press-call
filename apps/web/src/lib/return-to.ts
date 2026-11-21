// ログイン後に元の画面へ戻る
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
    if (safe && safe !== "/" && !safe.startsWith("/login")) {
      sessionStorage.setItem(RETURN_TO_KEY, safe);
    }
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

// 不透明なトークン（中身に意味のないランダム文字列）の生成とハッシュ。
// デバイストークン・リフレッシュトークン・ペアリングの deviceCode で共通に使う。
// Web Crypto だけを使うので、Worker・Node のスクリプト・テストのどこでも同じように動く

/** 32 バイト（256 ビット）の乱数を base64url にした文字列（43 文字）を作る */
export function randomBase64Url(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** DB に保存する値（SHA-256 の 16 進文字列）。平文は保存しない */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

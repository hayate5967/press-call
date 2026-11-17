// デバイストークンの生成とハッシュ（ADR-0006：DB で毎回確認する不透明トークン）
// Web Crypto だけを使うので、Worker・Node のスクリプト・テストのどこでも同じように動く

const TOKEN_PREFIX = "dvt_";
const TOKEN_BYTES = 32;

/** 推測できないデバイストークンを作る。例：dvt_7Gk2...（base64url で 43 文字） */
export function generateDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return TOKEN_PREFIX + toBase64Url(bytes);
}

/** DB の device_tokens.token_hash に入れる値（SHA-256 の 16 進文字列） */
export async function hashDeviceToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

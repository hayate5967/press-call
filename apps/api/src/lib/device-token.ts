// デバイストークンの生成とハッシュ（ADR-0006：DB で毎回確認する不透明トークン）
import { randomBase64Url, sha256Hex } from "./opaque-token";

const TOKEN_PREFIX = "dvt_";

/** 推測できないデバイストークンを作る。例：dvt_7Gk2...（base64url で 43 文字） */
export function generateDeviceToken(): string {
  return TOKEN_PREFIX + randomBase64Url();
}

/** DB の device_tokens.token_hash に入れる値（SHA-256 の 16 進文字列） */
export function hashDeviceToken(token: string): Promise<string> {
  return sha256Hex(token);
}

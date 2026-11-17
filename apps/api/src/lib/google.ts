// Google OAuth（Arctic、PKCE）。ADR-0005
//
// ルートからはこのインターフェイスだけを使い、テストでは偽物に差し替える（本物の Google を呼ばない）
import { decodeIdToken, Google } from "arctic";
import { z } from "zod";
import type { Bindings } from "../env";

/** Google で確認できた本人の情報 */
export type GoogleIdentity = {
  /** Google のアカウント ID（変わらない）。本人の特定にはこれを使う */
  sub: string;
  /** 表示用。変わりうるので本人の特定には使わない */
  email: string;
  name: string | null;
};

export interface GoogleOAuth {
  /** Google のログイン画面の URL（state と PKCE の code_challenge を含む） */
  authorizationUrl(state: string, codeVerifier: string): URL;
  /** 認可コードと PKCE の合言葉を Google に渡し、ID トークンから本人の情報を取り出す */
  exchange(code: string, codeVerifier: string): Promise<GoogleIdentity>;
}

export type CreateGoogle = (env: Bindings, redirectUri: string) => GoogleOAuth;

const SCOPES = ["openid", "email", "profile"];

const idTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  name: z.string().optional(),
});

/** 本物の Google につなぐ実装 */
export const createArcticGoogle: CreateGoogle = (env, redirectUri) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください");
  }
  const google = new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  return {
    authorizationUrl: (state, codeVerifier) =>
      google.createAuthorizationURL(state, codeVerifier, SCOPES),
    async exchange(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      // ID トークンは Google のトークン API から TLS で直接受け取ったものなので、
      // 署名の検証は省いてよい（OpenID Connect Core 3.1.3.7）
      const claims = idTokenClaimsSchema.parse(decodeIdToken(tokens.idToken()));
      return { sub: claims.sub, email: claims.email, name: claims.name ?? null };
    },
  };
};

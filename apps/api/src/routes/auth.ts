// ユーザー認証の API（API 仕様書 3 章、ADR-0005）
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { accessTokenResponseSchema, type LoginErrorCode, meSchema } from "@press-call/shared";
import { generateCodeVerifier, generateState } from "arctic";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import type { CreateGoogle } from "../lib/google";
import { ACCESS_TOKEN_TTL_SECONDS, loadSigningKeys, signAccessToken } from "../lib/jwt";
import { publicOrigin } from "../lib/origin";
import { userAuth } from "../middleware/auth-user";
import { ApiError, problemResponse, validationHook } from "../middleware/error";
import { findUser } from "../repositories/users";
import {
  findOrCreateGoogleUser,
  revokeRefreshToken,
  rotateRefreshToken,
  startRefreshFamily,
} from "../services/auth";

// ---------- Cookie ----------

export const REFRESH_COOKIE = "rt";
/** rt は認証の API にだけ送らせ、漏れる範囲を小さくする */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export const STATE_COOKIE = "oauth_state";
export const VERIFIER_COOKIE = "oauth_verifier";
const OAUTH_COOKIE_PATH = "/api/v1/auth/google";
const OAUTH_COOKIE_MAX_AGE = 10 * 60;

/**
 * Secure は HTTPS のときだけ付ける。本番は常に HTTPS。
 * 手元の http://localhost で Secure を付けると、Safari が Cookie を保存しないため
 */
const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

function setRefreshCookie(c: Context, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Strict",
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

function clearRefreshCookie(c: Context) {
  deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, secure: isHttps(c) });
}

/** Google ログイン中の一時的な Cookie。Google から戻るとき（別サイトからの遷移）にも送られるよう Lax */
function setOAuthCookie(c: Context, name: string, value: string) {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
}

function clearOAuthCookies(c: Context) {
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE]) {
    deleteCookie(c, name, { path: OAUTH_COOKIE_PATH, secure: isHttps(c) });
  }
}

/** Google に登録するリダイレクト URI（Google Cloud Console の「承認済みのリダイレクト URI」と同じ値） */
export const callbackUrl = (c: Context<AppEnv>) => `${publicOrigin(c)}/api/v1/auth/google/callback`;

const loginErrorUrl = (code: LoginErrorCode) => `/login?error=${encodeURIComponent(code)}`;

const loginError = (c: Context, code: LoginErrorCode) => c.redirect(loginErrorUrl(code), 302);

/**
 * Google から戻ってきたところ（ブラウザのページ遷移）で起きたエラーは、JSON を見せずにログイン画面へ移す。
 * DB の接続失敗（withDb）もここで受けられるよう、ルートより前のミドルウェアとして使う
 */
export const callbackErrorsToLogin = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.error) {
    console.error("ログインの完了に失敗しました", c.error);
    // エラーの応答を差し替える。前の応答の Set-Cookie（oauth_* の削除）は Hono が引き継ぐ
    c.res = new Response(null, {
      status: 302,
      headers: { Location: loginErrorUrl("oauth_failed") },
    });
  }
});

async function issueAccessToken(c: Context<AppEnv>, userId: string) {
  const keys = await loadSigningKeys(c.env.JWT_PRIVATE_JWK);
  const accessToken = await signAccessToken(keys, { userId, issuer: publicOrigin(c) });
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

// ---------- ルート ----------

const startRoute = createRoute({
  method: "get",
  path: "/auth/google/start",
  tags: ["ユーザー認証"],
  summary: "Google のログイン画面へリダイレクト",
  description:
    "state と PKCE の合言葉を Cookie に入れて、Google へ 302 する。スコープは openid email profile",
  responses: { 302: { description: "Google のログイン画面へ" } },
});

const callbackRoute = createRoute({
  method: "get",
  path: "/auth/google/callback",
  tags: ["ユーザー認証"],
  summary: "Google から戻ってきたところ。ログインを完了する",
  description:
    "成功したら rt Cookie を入れて / へ 302。失敗したら /login?error=<code> へ 302 " +
    "（oauth_denied・oauth_state_mismatch・oauth_failed）",
  responses: { 302: { description: "/ または /login?error=<code> へ" } },
});

const refreshRoute = createRoute({
  method: "post",
  path: "/auth/refresh",
  tags: ["ユーザー認証"],
  summary: "アクセストークンの再発行とリフレッシュトークンの交換",
  description:
    "rt Cookie だけを使う（ボディなし）。使用済みの rt が来たら系統ごと失効させる。" +
    "使用後 10 秒以内の再利用（2 つのタブからの同時更新）は、アクセストークンだけ返して Cookie は変えない",
  responses: {
    200: {
      description: "新しいアクセストークン（新しい rt は Set-Cookie で返す）",
      content: { "application/json": { schema: accessTokenResponseSchema } },
    },
    401: problemResponse(
      "rt が無効・期限切れ（refresh_token_invalid）、または使用済みの再利用（refresh_token_reused）",
    ),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["ユーザー認証"],
  summary: "ログアウト（リフレッシュトークンを系統ごと失効）",
  responses: { 204: { description: "ログアウトした（rt Cookie も削除）" } },
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["ユーザー認証"],
  summary: "自分の情報",
  middleware: [userAuth] as const,
  responses: {
    200: { description: "自分の情報", content: { "application/json": { schema: meSchema } } },
    401: problemResponse("ログインしていない（token_missing・token_expired・token_invalid）"),
  },
});

export function authRoutes(createGoogle: CreateGoogle) {
  return new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
    .openapi(startRoute, (c) => {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = createGoogle(c.env, callbackUrl(c)).authorizationUrl(state, codeVerifier);
      setOAuthCookie(c, STATE_COOKIE, state);
      setOAuthCookie(c, VERIFIER_COOKIE, codeVerifier);
      return c.redirect(url.toString(), 302);
    })
    .openapi(callbackRoute, async (c) => {
      const expectedState = getCookie(c, STATE_COOKIE);
      const codeVerifier = getCookie(c, VERIFIER_COOKIE);
      // 1 回きりの値なので、成否にかかわらず消す
      clearOAuthCookies(c);

      const { code, state, error } = c.req.query();
      // state を先に確かめる。一致しない応答は、誰かが仕込んだものかもしれない（CSRF）
      if (!expectedState || !codeVerifier || !state || state !== expectedState) {
        return loginError(c, "oauth_state_mismatch");
      }
      if (error || !code) return loginError(c, "oauth_denied");

      let identity: Awaited<ReturnType<ReturnType<CreateGoogle>["exchange"]>>;
      try {
        identity = await createGoogle(c.env, callbackUrl(c)).exchange(code, codeVerifier);
      } catch (err) {
        // 認可コードの期限切れ・使い回し、Google との通信失敗など
        console.error("Google ログインに失敗しました", err);
        return loginError(c, "oauth_failed");
      }

      const userId = await findOrCreateGoogleUser(c.var.db, identity);
      setRefreshCookie(c, await startRefreshFamily(c.var.db, userId));
      return c.redirect("/", 302);
    })
    .openapi(refreshRoute, async (c) => {
      const token = getCookie(c, REFRESH_COOKIE);
      if (!token) {
        throw new ApiError(401, "refresh_token_invalid", "ログインし直してください");
      }
      const result = await rotateRefreshToken(c.var.db, token);
      switch (result.kind) {
        case "rotated":
          setRefreshCookie(c, result.refreshToken);
          return c.json(await issueAccessToken(c, result.userId), 200);
        case "grace":
          return c.json(await issueAccessToken(c, result.userId), 200);
        case "reused":
          clearRefreshCookie(c);
          throw new ApiError(
            401,
            "refresh_token_reused",
            "ログインし直してください",
            "使用済みのリフレッシュトークンが再び使われたため、安全のためログアウトしました",
          );
        case "invalid":
          clearRefreshCookie(c);
          throw new ApiError(401, "refresh_token_invalid", "ログインし直してください");
      }
    })
    .openapi(logoutRoute, async (c) => {
      const token = getCookie(c, REFRESH_COOKIE);
      if (token) await revokeRefreshToken(c.var.db, token);
      clearRefreshCookie(c);
      return c.body(null, 204);
    })
    .openapi(meRoute, async (c) => {
      const user = await findUser(c.var.db, c.var.user.userId);
      // 署名は正しいがユーザーがいない（DB を作り直したなど）。ログインし直してもらう
      if (!user) throw new ApiError(401, "token_invalid", "アクセストークンが不正です");
      return c.json(user, 200);
    });
}

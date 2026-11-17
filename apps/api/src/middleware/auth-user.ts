// ユーザー（Web アプリ）の認証（API 仕様書 1 章・3 章）
// Authorization: Bearer <アクセストークン（JWT）> を検証し、c.var.user にユーザー ID を入れる。
// DB は見ない（JWT の署名と期限だけで判断する。そのために寿命を 15 分と短くしている）
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { loadSigningKeys, verifyAccessToken } from "../lib/jwt";
import { publicOrigin } from "../lib/origin";
import { ApiError } from "./error";

const BEARER = /^Bearer[ ]+(\S+)[ ]*$/i;

export const userAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
  if (!token) {
    throw new ApiError(401, "token_missing", "ログインが必要です");
  }
  const keys = await loadSigningKeys(c.env.JWT_PRIVATE_JWK);
  const result = await verifyAccessToken(keys, token, publicOrigin(c));
  if (!result.ok) {
    // expired なら Web アプリは /auth/refresh してからやり直す。invalid ならログイン画面へ
    throw result.reason === "expired"
      ? new ApiError(401, "token_expired", "アクセストークンの期限が切れています")
      : new ApiError(401, "token_invalid", "アクセストークンが不正です");
  }
  c.set("user", { userId: result.userId });
  await next();
});

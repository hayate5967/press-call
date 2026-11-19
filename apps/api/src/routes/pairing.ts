// ペアリングの API（API 仕様書 4 章、ADR-0006、RFC 8628）
import { createRoute, OpenAPIHono, type z } from "@hono/zod-openapi";
import {
  approvePairingInputSchema,
  approvePairingResultSchema,
  DEVICE_CODE_GRANT_TYPE,
  denyPairingInputSchema,
  deviceAuthorizeInputSchema,
  deviceAuthorizeResponseSchema,
  deviceTokenErrorSchema,
  deviceTokenInputSchema,
  deviceTokenResponseSchema,
  formatUserCode,
} from "@press-call/shared";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { publicOrigin } from "../lib/origin";
import { userAuth } from "../middleware/auth-user";
import { problemResponse, validationHook } from "../middleware/error";
import { approvePairing, denyPairing, pollPairing, startPairing } from "../services/pairing";

/** Web アプリの許可画面の URL */
const verificationUri = (c: Context<AppEnv>) => `${publicOrigin(c)}/devices/pair`;

type TokenError = z.infer<typeof deviceTokenErrorSchema>["error"];

/** RFC 8628 の形のエラー（problem+json ではない）。トークンの応答はキャッシュさせない */
function tokenError(c: Context, error: TokenError) {
  c.header("Cache-Control", "no-store");
  return c.json({ error }, 400);
}

// ---------- ESP32 が呼ぶ（認証：none） ----------

const authorizeRoute = createRoute({
  method: "post",
  path: "/device/authorize",
  tags: ["ペアリング"],
  summary: "ESP32 がペアリングを開始し、コードを受け取る",
  description:
    "deviceCode は ESP32 だけが知る合言葉（DB にはハッシュだけ）。userCode は人が入力する 8 文字（表示は BCDF-GHJK）。期限は 10 分",
  request: {
    body: {
      required: false,
      content: { "application/json": { schema: deviceAuthorizeInputSchema } },
    },
  },
  responses: {
    200: {
      description: "コードを発行した",
      content: { "application/json": { schema: deviceAuthorizeResponseSchema } },
    },
    422: problemResponse("入力ルール違反（validation_failed）"),
    503: problemResponse("DB につながらない（db_unavailable）"),
  },
});

const tokenRoute = createRoute({
  method: "post",
  path: "/device/token",
  tags: ["ペアリング"],
  summary: "ESP32 が許可されたか確認し、デバイストークンを受け取る",
  description:
    "エラーは RFC 8628 の形（{ error }）。authorization_pending なら interval 秒後に、slow_down なら間隔を 5 秒延ばして問い合わせ直す。" +
    "access_denied・expired_token・invalid_grant なら最初からやり直す",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: deviceTokenInputSchema } },
    },
  },
  responses: {
    200: {
      description: "許可された。デバイストークンはこの 1 回だけ返す",
      content: { "application/json": { schema: deviceTokenResponseSchema } },
    },
    400: {
      description: "まだ許可されていない・期限切れなど（RFC 8628 3.5）",
      content: { "application/json": { schema: deviceTokenErrorSchema } },
    },
    503: problemResponse("DB につながらない（db_unavailable）"),
  },
});

// ---------- Web アプリが呼ぶ（認証：user） ----------

const approveRoute = createRoute({
  method: "post",
  path: "/pairings/approve",
  tags: ["ペアリング"],
  summary: "Web アプリでコードを入力して許可する",
  description:
    "許可するとデバイスと初期設定を作る。デバイストークンは次に ESP32 が /device/token を呼んだときに発行する。" +
    "userCode は大文字小文字とハイフンの有無を区別しない",
  middleware: [userAuth] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: approvePairingInputSchema } },
    },
  },
  responses: {
    200: {
      description: "許可した",
      content: { "application/json": { schema: approvePairingResultSchema } },
    },
    401: problemResponse("ログインしていない（token_missing・token_expired・token_invalid）"),
    404: problemResponse("コードがない（user_code_not_found）"),
    409: problemResponse("許可・拒否済み（pairing_already_handled）"),
    410: problemResponse("コードの期限切れ（user_code_expired）"),
    422: problemResponse("入力ルール違反（validation_failed）"),
  },
});

const denyRoute = createRoute({
  method: "post",
  path: "/pairings/deny",
  tags: ["ペアリング"],
  summary: "許可しない（身に覚えのないコードを拒否する）",
  middleware: [userAuth] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: denyPairingInputSchema } },
    },
  },
  responses: {
    204: { description: "拒否した。ESP32 は access_denied を受け取る" },
    401: problemResponse("ログインしていない（token_missing・token_expired・token_invalid）"),
    404: problemResponse("コードがない（user_code_not_found）"),
    409: problemResponse("許可・拒否済み（pairing_already_handled）"),
    410: problemResponse("コードの期限切れ（user_code_expired）"),
  },
});

export const pairing = new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
  .openapi(authorizeRoute, async (c) => {
    const started = await startPairing(c.var.db);
    const userCode = formatUserCode(started.userCode);
    const uri = verificationUri(c);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        deviceCode: started.deviceCode,
        userCode,
        verificationUri: uri,
        verificationUriComplete: `${uri}?code=${encodeURIComponent(userCode)}`,
        expiresIn: started.expiresIn,
        interval: started.interval,
      },
      200,
    );
  })
  .openapi(
    tokenRoute,
    async (c) => {
      const input = c.req.valid("json");
      if (input.grantType !== DEVICE_CODE_GRANT_TYPE)
        return tokenError(c, "unsupported_grant_type");
      const result = await pollPairing(c.var.db, input.deviceCode);
      if (!result.ok) return tokenError(c, result.error);
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          accessToken: result.accessToken,
          tokenType: "Bearer" as const,
          deviceId: result.deviceId,
        },
        200,
      );
    },
    // このルートだけは入力の誤りも RFC の形（invalid_request）で返す
    (result, c) => (result.success ? undefined : tokenError(c, "invalid_request")),
  )
  .openapi(approveRoute, async (c) => {
    const result = await approvePairing(c.var.db, c.var.user.userId, c.req.valid("json"));
    return c.json(result, 200);
  })
  .openapi(denyRoute, async (c) => {
    await denyPairing(c.var.db, c.var.user.userId, c.req.valid("json").userCode);
    return c.body(null, 204);
  });

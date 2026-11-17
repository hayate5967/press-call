// デバイス（ESP32）向け API（API 仕様書 5 章）
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  createSetInputSchema,
  createSetResultSchema,
  deviceSettingsSchema,
} from "@press-call/shared";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { deviceAuth } from "../middleware/auth-device";
import { payloadTooLarge, problemResponse, validationHook } from "../middleware/error";
import { getDeviceSettings } from "../services/device-settings";
import { registerSet } from "../services/sets";

/** POST /device/sets のボディ上限（API 仕様書 5 章：リクエスト全体は 64KB まで） */
export const CREATE_SET_MAX_BYTES = 64 * 1024;

const createSetRoute = createRoute({
  method: "post",
  path: "/device/sets",
  tags: ["デバイス向け"],
  summary: "セットとレップを登録（冪等）",
  description:
    "同じ clientSetId が再送されたときは、中身を更新せずに既存のセットを 200 で返す。" +
    "セットは開始時刻（日本時間）の日付の練習日に自動でまとめる。",
  // 認証 → サイズ確認 → 入力チェック（Zod）→ 処理 の順に進む
  middleware: [
    deviceAuth,
    bodyLimit({ maxSize: CREATE_SET_MAX_BYTES, onError: payloadTooLarge }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createSetInputSchema } },
    },
  },
  responses: {
    201: {
      description: "初めて届いたセットを登録した",
      content: { "application/json": { schema: createSetResultSchema } },
    },
    200: {
      description: "同じ clientSetId のセットが登録済み。中身は更新していない",
      content: { "application/json": { schema: createSetResultSchema } },
    },
    400: problemResponse("JSON が壊れている（bad_request）"),
    401: problemResponse(
      "デバイストークンがない・存在しない（device_token_invalid）、または失効済み（device_token_revoked）",
    ),
    413: problemResponse("リクエストが 64KB を超えた（payload_too_large）"),
    422: problemResponse("入力ルール違反（validation_failed）。再送しても通らない"),
    503: problemResponse("DB につながらない（db_unavailable）。時間を置いて再送する"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  path: "/device/settings",
  tags: ["デバイス向け"],
  summary: "最新の設定を取得",
  description:
    'ESP32 がセット中でないときに数秒おきに呼ぶ。If-None-Match に手元の version（例："3"）を入れると、' +
    "変わっていなければ 304（ボディなし）を返す。ETag は version。",
  middleware: [deviceAuth] as const,
  responses: {
    200: {
      description: "設定（ETag に version が入る）",
      content: { "application/json": { schema: deviceSettingsSchema } },
    },
    304: { description: "手元の設定と同じ（If-None-Match の version と一致）" },
    401: problemResponse(
      "デバイストークンがない・存在しない（device_token_invalid）、または失効済み（device_token_revoked）",
    ),
    503: problemResponse("DB につながらない（db_unavailable）。時間を置いて問い合わせ直す"),
  },
});

/** ETag の値。設定の version をそのまま使う（例："4"） */
export const settingsEtag = (version: number) => `"${version}"`;

/**
 * If-None-Match（RFC 9110 13.1.2）が今の ETag に一致するか。
 * カンマ区切りの複数指定・弱い比較（W/ 付き）・"*" にも対応する
 */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((t) => t.trim())
    .some((t) => t === "*" || t.replace(/^W\//, "") === etag);
}

export const device = new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
  .openapi(createSetRoute, async (c) => {
    const result = await registerSet(c.var.db, c.var.device, c.req.valid("json"));
    return result.created ? c.json(result, 201) : c.json(result, 200);
  })
  .openapi(getSettingsRoute, async (c) => {
    const settings = await getDeviceSettings(c.var.db, c.var.device.deviceId);
    const etag = settingsEtag(settings.version);
    c.header("ETag", etag);
    // 毎回 DB を見て判断させるため、途中でキャッシュさせない
    c.header("Cache-Control", "no-cache");
    if (matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
      return c.body(null, 304);
    }
    return c.json(settings, 200);
  });

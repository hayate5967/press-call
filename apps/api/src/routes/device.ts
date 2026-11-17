// デバイス（ESP32）向け API（API 仕様書 5 章）
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createSetInputSchema, createSetResultSchema } from "@press-call/shared";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { devDevice } from "../middleware/auth-device";
import { payloadTooLarge, problemResponse, validationHook } from "../middleware/error";
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
    devDevice,
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
    401: problemResponse("デバイスを確認できない（device_token_invalid）"),
    413: problemResponse("リクエストが 64KB を超えた（payload_too_large）"),
    422: problemResponse("入力ルール違反（validation_failed）。再送しても通らない"),
    503: problemResponse("DB につながらない（db_unavailable）。時間を置いて再送する"),
  },
});

export const device = new OpenAPIHono<AppEnv>({ defaultHook: validationHook }).openapi(
  createSetRoute,
  async (c) => {
    const result = await registerSet(c.var.db, c.var.device, c.req.valid("json"));
    return result.created ? c.json(result, 201) : c.json(result, 200);
  },
);

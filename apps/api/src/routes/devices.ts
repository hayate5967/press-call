// デバイス管理・設定の API（Web アプリ向け、API 仕様書 6 章）
// すべて user 認証。他人のデバイスの ID を指定されたら 404（assertOwnedDevice）
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  deviceListSchema,
  deviceSchema,
  deviceSettingsDetailSchema,
  deviceSettingsInputSchema,
  recordingStateSchema,
  renameDeviceInputSchema,
  setRecordingInputSchema,
} from "@press-call/shared";
import type { AppEnv } from "../env";
import { userAuth } from "../middleware/auth-user";
import { ApiError, problemResponse, validationHook } from "../middleware/error";
import { listDevices } from "../repositories/devices";
import { getRecordingState, setRecording } from "../services/device-recordings";
import { getDeviceSettingsDetail, putDeviceSettings } from "../services/device-settings";
import { assertOwnedDevice, renameDevice, revokeDevice, toDevice } from "../services/devices";
import { settingsEtag } from "./device";

const deviceIdParams = z.object({
  deviceId: z.uuid().openapi({ param: { name: "deviceId", in: "path" } }),
});

const unauthorized = problemResponse(
  "ログインしていない（token_missing・token_expired・token_invalid）",
);

const listRoute = createRoute({
  method: "get",
  path: "/devices",
  tags: ["デバイス管理"],
  summary: "デバイス一覧（最終通信日時つき）",
  middleware: [userAuth] as const,
  responses: {
    200: {
      description: "自分のデバイス（新しい順）。active は有効なデバイストークンがあるか",
      content: { "application/json": { schema: deviceListSchema } },
    },
    401: unauthorized,
  },
});

const renameRoute = createRoute({
  method: "patch",
  path: "/devices/{deviceId}",
  tags: ["デバイス管理"],
  summary: "デバイス名の変更",
  middleware: [userAuth] as const,
  request: {
    params: deviceIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: renameDeviceInputSchema } },
    },
  },
  responses: {
    200: {
      description: "変更後のデバイス",
      content: { "application/json": { schema: deviceSchema } },
    },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
    422: problemResponse("名前が空・50 文字を超える（validation_failed）"),
  },
});

const revokeRoute = createRoute({
  method: "post",
  path: "/devices/{deviceId}/revoke",
  tags: ["デバイス管理"],
  summary: "デバイストークンを失効（盗難・紛失時）",
  description:
    "そのデバイスのトークンをすべて失効させる。以降 ESP32 は 401 device_token_revoked を受け取る。" +
    "記録は消えない。再び使うにはペアリングし直す。失効済みでも 204",
  middleware: [userAuth] as const,
  request: { params: deviceIdParams },
  responses: {
    204: { description: "失効させた" },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
  },
});

const getRecordingRoute = createRoute({
  method: "get",
  path: "/devices/{deviceId}/recording",
  tags: ["記録の指示"],
  summary: "記録の状態（記録中か・デバイスに伝わったか）",
  middleware: [userAuth] as const,
  request: { params: deviceIdParams },
  responses: {
    200: {
      description: "ackedSeq が seq と同じなら、デバイスに伝わっている",
      content: { "application/json": { schema: recordingStateSchema } },
    },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
  },
});

const putRecordingRoute = createRoute({
  method: "put",
  path: "/devices/{deviceId}/recording",
  tags: ["記録の指示"],
  summary: "セットの開始・終了",
  description:
    "ADR-0011。今と違う状態を送ると seq を 1 増やし、開始なら startedAt、終了なら stoppedAt に今の時刻を入れる。" +
    "今と同じ状態なら何も変えない（二度押し・再送で番号が進まない）。デバイスは 5 秒おきに取りに来る",
  middleware: [userAuth] as const,
  request: {
    params: deviceIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: setRecordingInputSchema } },
    },
  },
  responses: {
    200: {
      description: "変更後の状態",
      content: { "application/json": { schema: recordingStateSchema } },
    },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
    422: problemResponse("recording が真偽値でない（validation_failed）"),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  path: "/devices/{deviceId}/settings",
  tags: ["設定"],
  summary: "設定の取得",
  middleware: [userAuth] as const,
  request: { params: deviceIdParams },
  responses: {
    200: {
      description: "設定（ETag に version が入る）",
      content: { "application/json": { schema: deviceSettingsDetailSchema } },
    },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
  },
});

const putSettingsRoute = createRoute({
  method: "put",
  path: "/devices/{deviceId}/settings",
  tags: ["設定"],
  summary: "設定の変更（まるごと置き換え）",
  description:
    'If-Match: "<version>" を付けると、その間に別の画面で変更されていたら 412 で止める。' +
    "更新のたびに version が 1 増え、ESP32 は次の問い合わせで新しい設定を受け取る",
  middleware: [userAuth] as const,
  request: {
    params: deviceIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: deviceSettingsInputSchema } },
    },
  },
  responses: {
    200: {
      description: "変更後の設定",
      content: { "application/json": { schema: deviceSettingsDetailSchema } },
    },
    401: unauthorized,
    404: problemResponse("デバイスがない、または他人のデバイス（not_found）"),
    412: problemResponse("If-Match の version が古い（precondition_failed）"),
    422: problemResponse("入力ルール違反（validation_failed）"),
  },
});

/**
 * If-Match（RFC 9110 13.1.1）から、受け入れてよい version の一覧を取り出す。
 * ヘッダーなし・"*" なら条件なし（undefined）。カンマ区切りの複数指定に対応する。
 * If-Match は強い比較なので、W/ 付き（弱い ETag）や形の違う値は一致しない扱いにする。
 * 一致しうる値が 1 つもなければ 412
 */
export function parseIfMatch(header: string | undefined): number[] | undefined {
  if (header === undefined || header.trim() === "*") return undefined;
  const versions: number[] = [];
  for (const part of header.split(",")) {
    const match = /^\s*"(\d{1,9})"\s*$/.exec(part);
    if (match) versions.push(Number(match[1]));
  }
  if (versions.length === 0) {
    throw new ApiError(412, "precondition_failed", "設定が別の画面で変更されています");
  }
  return versions;
}

export const devicesRoutes = new OpenAPIHono<AppEnv>({ defaultHook: validationHook })
  .openapi(listRoute, async (c) => {
    const items = await listDevices(c.var.db, c.var.user.userId);
    return c.json({ items: items.map(toDevice) }, 200);
  })
  .openapi(renameRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    const { name } = c.req.valid("json");
    return c.json(await renameDevice(c.var.db, c.var.user.userId, deviceId, name), 200);
  })
  .openapi(getRecordingRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    c.header("Cache-Control", "no-store");
    return c.json(await getRecordingState(c.var.db, c.var.user.userId, deviceId), 200);
  })
  .openapi(putRecordingRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    const { recording } = c.req.valid("json");
    return c.json(await setRecording(c.var.db, c.var.user.userId, deviceId, recording), 200);
  })
  .openapi(revokeRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    await revokeDevice(c.var.db, c.var.user.userId, deviceId);
    return c.body(null, 204);
  })
  .openapi(getSettingsRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    await assertOwnedDevice(c.var.db, c.var.user.userId, deviceId);
    const settings = await getDeviceSettingsDetail(c.var.db, deviceId);
    c.header("ETag", settingsEtag(settings.version));
    c.header("Cache-Control", "no-store");
    return c.json(settings, 200);
  })
  .openapi(putSettingsRoute, async (c) => {
    const { deviceId } = c.req.valid("param");
    await assertOwnedDevice(c.var.db, c.var.user.userId, deviceId);
    const expected = parseIfMatch(c.req.header("If-Match"));
    const settings = await putDeviceSettings(c.var.db, deviceId, c.req.valid("json"), expected);
    c.header("ETag", settingsEtag(settings.version));
    return c.json(settings, 200);
  });

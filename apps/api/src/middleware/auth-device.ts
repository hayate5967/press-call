// デバイス（ESP32）の認証（API 仕様書 1 章・5 章、ADR-0006）
// Authorization: Bearer <デバイストークン> をハッシュし、device_tokens と照合する。
// 認証できたら、デバイスと持ち主を c.var.device に入れる。記録はこの持ち主のものとして保存される
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { hashDeviceToken } from "../lib/device-token";
import { findDeviceByTokenHash, touchDevice } from "../repositories/devices";
import { ApiError } from "./error";

const BEARER = /^Bearer[ ]+(\S+)[ ]*$/i;

export const deviceAuth = createMiddleware<AppEnv>(async (c, next) => {
  // ヘッダーがない・形が違うときも device_token_invalid にする。
  // ESP32 にとってはどれも「ペアリングをやり直す」で、分けても動きが変わらないため
  const match = BEARER.exec(c.req.header("Authorization") ?? "");
  const token = match?.[1];
  if (!token) {
    throw new ApiError(401, "device_token_invalid", "デバイスを確認できません");
  }

  const found = await findDeviceByTokenHash(c.var.db, await hashDeviceToken(token));
  if (!found) {
    throw new ApiError(401, "device_token_invalid", "デバイスを確認できません");
  }
  if (found.revokedAt) {
    // ESP32 は記録を消さずに再ペアリングを待つ（API 仕様書 5 章）
    throw new ApiError(401, "device_token_revoked", "デバイストークンは失効しています");
  }

  // デバイス向け API が呼ばれるたびに last_seen_at を更新する（API 仕様書 5 章）
  await touchDevice(c.var.db, found.deviceId, found.tokenId);

  c.set("device", { deviceId: found.deviceId, userId: found.userId });
  await next();
});

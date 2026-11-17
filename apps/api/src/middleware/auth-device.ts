// 【仮・ステップ3で削除】デバイスの認証。ステップ3でデバイストークン（Authorization: Bearer）の照合に
// 置き換え、このファイルと DEV_DEVICE_ID は消す。
// いまは開発環境（ENVIRONMENT=development）でだけ、DEV_DEVICE_ID のデバイスから届いたものとして扱う
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { devices } from "../db/schema";
import type { AppEnv } from "../env";
import { ApiError } from "./error";

export const devDevice = createMiddleware<AppEnv>(async (c, next) => {
  // 本番は wrangler.jsonc で ENVIRONMENT=production に固定している。
  // 誤って本番に DEV_DEVICE_ID を登録しても、ここで弾かれて誰でも記録を送れる状態にはならない
  if (c.env?.ENVIRONMENT !== "development") {
    throw new ApiError(401, "device_token_invalid", "デバイスを確認できません");
  }
  const deviceId = c.env.DEV_DEVICE_ID;
  if (!deviceId || !z.uuid().safeParse(deviceId).success) {
    throw new ApiError(401, "device_token_invalid", "デバイスを確認できません");
  }
  const [device] = await c.var.db
    .select({ deviceId: devices.id, userId: devices.userId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  if (!device) {
    throw new ApiError(401, "device_token_invalid", "デバイスを確認できません");
  }
  c.set("device", device);
  await next();
});

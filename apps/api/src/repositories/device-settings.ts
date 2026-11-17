// デバイスの設定（モード・待ち時間・静止のしきい値）の DB アクセス
import type { DeviceSettings, DeviceSettingsInput, Pause } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { deviceSettings } from "../db/schema";

type Row = typeof deviceSettings.$inferSelect;

/** 待ち時間を DB の列（pause_mode・pause_fixed_ms・pause_min_ms・pause_max_ms）に分ける */
function pauseColumns(pause: Pause | null) {
  if (pause === null) {
    return { pauseMode: null, pauseFixedMs: null, pauseMinMs: null, pauseMaxMs: null };
  }
  return pause.mode === "fixed"
    ? {
        pauseMode: "fixed" as const,
        pauseFixedMs: pause.fixedMs,
        pauseMinMs: null,
        pauseMaxMs: null,
      }
    : {
        pauseMode: "random" as const,
        pauseFixedMs: null,
        pauseMinMs: pause.minMs,
        pauseMaxMs: pause.maxMs,
      };
}

/** DB の行を API の形（GET /device/settings のレスポンス）にする */
function toSettings(row: Row): DeviceSettings {
  let pause: Pause | null = null;
  if (row.pauseMode === "fixed" && row.pauseFixedMs !== null) {
    pause = { mode: "fixed", fixedMs: row.pauseFixedMs };
  } else if (row.pauseMode === "random" && row.pauseMinMs !== null && row.pauseMaxMs !== null) {
    pause = { mode: "random", minMs: row.pauseMinMs, maxMs: row.pauseMaxMs };
  }
  return { version: row.version, mode: row.mode, pause, stillThreshold: row.stillThreshold };
}

export async function findDeviceSettings(
  db: Db,
  deviceId: string,
): Promise<DeviceSettings | undefined> {
  const [row] = await db.select().from(deviceSettings).where(eq(deviceSettings.deviceId, deviceId));
  return row && toSettings(row);
}

/** 設定の行がなければ作る（あれば何もしない） */
export async function insertDeviceSettingsIfAbsent(
  db: Db,
  deviceId: string,
  input: DeviceSettingsInput,
): Promise<void> {
  await db
    .insert(deviceSettings)
    .values({
      deviceId,
      mode: input.mode,
      ...pauseColumns(input.pause),
      stillThreshold: input.stillThreshold,
    })
    .onConflictDoNothing({ target: deviceSettings.deviceId });
}

/** 設定をまるごと置き換え、version を 1 つ進める。行がなければ作る */
export async function replaceDeviceSettings(
  db: Db,
  deviceId: string,
  input: DeviceSettingsInput,
): Promise<DeviceSettings> {
  const values = {
    mode: input.mode,
    ...pauseColumns(input.pause),
    stillThreshold: input.stillThreshold,
  };
  const [row] = await db
    .insert(deviceSettings)
    .values({ deviceId, ...values })
    .onConflictDoUpdate({
      target: deviceSettings.deviceId,
      set: { ...values, version: sql`${deviceSettings.version} + 1`, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error("設定を保存できませんでした");
  return toSettings(row);
}

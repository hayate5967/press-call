// デバイスの設定（モード・待ち時間・静止のしきい値）の DB アクセス
import type { DeviceSettings, DeviceSettingsDetail, DeviceSettingsInput } from "@press-call/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pauseColumns, pauseFromColumns } from "../db/pause";
import { deviceSettings } from "../db/schema";

type Row = typeof deviceSettings.$inferSelect;

/** DB の行を API の形（GET /device/settings のレスポンス）にする */
function toSettings(row: Row): DeviceSettings {
  return {
    version: row.version,
    mode: row.mode,
    pause: pauseFromColumns(row),
    stillThreshold: row.stillThreshold,
  };
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

/** 設定と更新日時（Web アプリ向け。GET・PUT /devices/{deviceId}/settings） */
export async function findDeviceSettingsDetail(
  db: Db,
  deviceId: string,
): Promise<DeviceSettingsDetail | undefined> {
  const [row] = await db.select().from(deviceSettings).where(eq(deviceSettings.deviceId, deviceId));
  return row && { ...toSettings(row), updatedAt: row.updatedAt.toISOString() };
}

/**
 * 設定を置き換えて version を 1 つ進める。行があることが前提。
 * expectedVersions を渡したときは、今の version がそのどれかのときだけ更新する
 * （If-Match。別の画面での変更を上書きしないため）。更新できなければ undefined
 */
export async function updateDeviceSettingsRow(
  db: Db,
  deviceId: string,
  input: DeviceSettingsInput,
  expectedVersions?: number[],
): Promise<DeviceSettingsDetail | undefined> {
  const [row] = await db
    .update(deviceSettings)
    .set({
      mode: input.mode,
      ...pauseColumns(input.pause),
      stillThreshold: input.stillThreshold,
      version: sql`${deviceSettings.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      expectedVersions === undefined
        ? eq(deviceSettings.deviceId, deviceId)
        : and(
            eq(deviceSettings.deviceId, deviceId),
            inArray(deviceSettings.version, expectedVersions),
          ),
    )
    .returning();
  return row && { ...toSettings(row), updatedAt: row.updatedAt.toISOString() };
}

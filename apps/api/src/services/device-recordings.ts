// セットの開始・終了の指示（ADR-0011、FR-D03・FR-V11）
import type { DeviceRecording, RecordingState } from "@press-call/shared";
import type { Db } from "../db/client";
import {
  ackRecording,
  findRecording,
  type RecordingRow,
  stopRecordingByDevice,
  switchRecording,
} from "../repositories/device-recordings";
import { assertOwnedDevice } from "./devices";

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Web アプリ向けの形。行がなければ「停止中・番号 0」 */
function toState(row: RecordingRow | undefined): RecordingState {
  return {
    recording: row?.recording ?? false,
    seq: row?.seq ?? 0,
    startedAt: iso(row?.startedAt),
    stoppedAt: iso(row?.stoppedAt),
    ackedSeq: row?.ackedSeq ?? 0,
    updatedAt: iso(row?.updatedAt),
  };
}

/** ESP32 向けの形（サーバの時刻つき） */
function toDeviceRecording(row: RecordingRow | undefined, now: Date): DeviceRecording {
  return {
    recording: row?.recording ?? false,
    seq: row?.seq ?? 0,
    startedAt: iso(row?.startedAt),
    stoppedAt: iso(row?.stoppedAt),
    serverTime: now.toISOString(),
  };
}

/** 記録の状態（GET /devices/{id}/recording）。他人のデバイスは 404 */
export async function getRecordingState(
  db: Db,
  userId: string,
  deviceId: string,
): Promise<RecordingState> {
  await assertOwnedDevice(db, userId, deviceId);
  return toState(await findRecording(db, deviceId));
}

/** セットの開始・終了（PUT /devices/{id}/recording）。他人のデバイスは 404 */
export async function setRecording(
  db: Db,
  userId: string,
  deviceId: string,
  recording: boolean,
): Promise<RecordingState> {
  await assertOwnedDevice(db, userId, deviceId);
  // 行がない（＝停止中）ときに「終了」を押しても何もしない
  const current = await findRecording(db, deviceId);
  if ((current?.recording ?? false) !== recording) {
    await switchRecording(db, deviceId, recording);
  }
  return toState(await findRecording(db, deviceId));
}

/** ESP32 が指示を取りに来た（GET /device/recording）。受け取った番号を記録してから返す */
export async function pollRecording(db: Db, deviceId: string): Promise<DeviceRecording> {
  await ackRecording(db, deviceId);
  return toDeviceRecording(await findRecording(db, deviceId), new Date());
}

/** ESP32 が自分でセットを終えた（PUT /device/recording） */
export async function stopRecordingFromDevice(
  db: Db,
  deviceId: string,
  seq: number,
): Promise<DeviceRecording> {
  await stopRecordingByDevice(db, deviceId, seq);
  return toDeviceRecording(await findRecording(db, deviceId), new Date());
}

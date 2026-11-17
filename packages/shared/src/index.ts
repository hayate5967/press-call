// API と Web アプリで共有するリクエスト・レスポンスの形（API 仕様書に対応）
import { z } from "zod";

/** 待ち時間の範囲（ミリ秒）。API 仕様書 6 章の PUT /devices/{id}/settings のルール */
export const PAUSE_MIN_MS = 200;
export const PAUSE_MAX_MS = 5000;

const pauseMs = z.number().int().min(PAUSE_MIN_MS).max(PAUSE_MAX_MS);

/**
 * 静止のしきい値（m/s）の上限（この値は含まない）。ファームの「動き出した」とみなす速さ
 * （firmware/lib/detection の DetectorConfig.moveVelocity）と同じ値。
 * 静止のしきい値がこれ以上だと「止まっている」と「動いている」の判定が重なり、
 * 胸の上で止まる前の減速や挙上の始まりも静止とみなしてしまう（ADR-0003）
 */
export const STILL_THRESHOLD_MAX_MPS = 0.15;

const stillThreshold = z
  .number()
  .positive()
  .lt(STILL_THRESHOLD_MAX_MPS, {
    message: `stillThreshold は ${STILL_THRESHOLD_MAX_MPS} 未満にしてください（動き出しの判定と重ならないように）`,
  });

/** 待ち時間の設定：固定 or ランダム */
export const pauseSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), fixedMs: pauseMs }),
  z
    .object({ mode: z.literal("random"), minMs: pauseMs, maxMs: pauseMs })
    .refine((p) => p.minMs <= p.maxMs, {
      message: "minMs は maxMs 以下にしてください",
      path: ["minMs"],
    }),
]);
export type Pause = z.infer<typeof pauseSchema>;

export const modeSchema = z.enum(["auto_signal", "count_only"]);
export type Mode = z.infer<typeof modeSchema>;

/** 自動合図モードなら pause 必須、回数記録モードなら pause は null */
function pauseMatchesMode(v: { mode: Mode; pause: Pause | null }) {
  return v.mode === "auto_signal" ? v.pause !== null : v.pause === null;
}
const pauseModeMessage = {
  message: "auto_signal では pause が必須、count_only では pause は null にしてください",
  path: ["pause"],
};

/** PUT /devices/{deviceId}/settings のリクエスト */
export const deviceSettingsInputSchema = z
  .object({
    mode: modeSchema,
    pause: pauseSchema.nullable(),
    stillThreshold: stillThreshold.nullable(),
  })
  .refine(pauseMatchesMode, pauseModeMessage);
export type DeviceSettingsInput = z.infer<typeof deviceSettingsInputSchema>;

/** GET /device/settings のレスポンス */
export const deviceSettingsSchema = z.object({
  version: z.number().int().nonnegative(),
  mode: modeSchema,
  pause: pauseSchema.nullable(),
  stillThreshold: stillThreshold.nullable(),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

/*
 * DB の列の型に入る範囲。ここを超える値が DB まで届くと INSERT が失敗して 500 になり、
 * ESP32 は「一時的な失敗」とみなして永久に再送してしまう。入口で 422 にして再送を止める
 */
const INT4_MAX = 2_147_483_647; // PostgreSQL の int
const INT2_MAX = 32_767; // PostgreSQL の smallint
const msInt = z.number().int().nonnegative().max(INT4_MAX);
/** PostgreSQL の real（32 ビット浮動小数点数）で表せる大きさか */
const float4 = z
  .number()
  .refine(
    (v) => Number.isFinite(Math.fround(v)),
    "real（32 ビット浮動小数点数）の範囲を超えています",
  );

/** レップ（POST /device/sets の reps[]） */
export const repInputSchema = z.object({
  index: z.number().int().min(1).max(INT2_MAX),
  startOffsetMs: msInt,
  eccentricMs: msInt.nullable(),
  pauseTargetMs: msInt.nullable(),
  pauseActualMs: msInt.nullable(),
  reactionMs: msInt.nullable(),
  isPremature: z.boolean(),
  concentricMs: msInt.nullable(),
  meanVelocityMps: float4.nonnegative().nullable(),
  peakVelocityMps: float4.nonnegative().nullable(),
  curveHz: z.number().int().positive().max(INT2_MAX).nullable(),
  velocityCurve: z.array(float4).max(500).nullable(),
});
export type RepInput = z.infer<typeof repInputSchema>;

/** POST /device/sets のリクエスト */
export const createSetInputSchema = z
  .object({
    clientSetId: z.uuid(),
    settingsVersion: z.number().int().nonnegative(),
    mode: modeSchema,
    pause: pauseSchema.nullable(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    reps: z.array(repInputSchema).max(50),
  })
  .refine(pauseMatchesMode, pauseModeMessage)
  .refine((s) => Date.parse(s.startedAt) <= Date.parse(s.endedAt), {
    message: "startedAt は endedAt 以前にしてください",
    path: ["startedAt"],
  })
  .refine((s) => s.reps.every((r, i) => r.index === i + 1), {
    message: "reps[].index は 1 からの連番にしてください",
    path: ["reps"],
  })
  .refine(
    (s) =>
      s.mode === "auto_signal" ||
      s.reps.every((r) => r.pauseTargetMs === null && r.reactionMs === null && !r.isPremature),
    {
      // 合図がないので、待ち時間・反応時間・フライングは存在しない
      message:
        "count_only では reps[].pauseTargetMs と reps[].reactionMs は null、reps[].isPremature は false にしてください",
      path: ["reps"],
    },
  );
export type CreateSetInput = z.infer<typeof createSetInputSchema>;

/** POST /device/sets のレスポンス（初回は 201・created: true、再送は 200・created: false） */
export const createSetResultSchema = z.object({
  setId: z.uuid(),
  sessionId: z.uuid(),
  created: z.boolean(),
});
export type CreateSetResult = z.infer<typeof createSetResultSchema>;

/** PATCH /sets/{setId} のリクエスト（重量は 0.5kg 刻み、RPE は 0.5 刻み） */
const halfStep = (n: number) => Number.isInteger(n * 2);
export const updateSetInputSchema = z.object({
  weightKg: z.number().min(0).max(500).refine(halfStep, "0.5 刻みで入力してください").nullish(),
  rpe: z.number().min(1).max(10).refine(halfStep, "0.5 刻みで入力してください").nullish(),
  note: z.string().max(500).nullish(),
});
export type UpdateSetInput = z.infer<typeof updateSetInputSchema>;

/** GET /health のレスポンス */
export const healthSchema = z.object({
  status: z.literal("ok"),
  time: z.iso.datetime(),
});
export type Health = z.infer<typeof healthSchema>;

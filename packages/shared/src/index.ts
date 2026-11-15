// API と Web アプリで共有するリクエスト・レスポンスの形（API 仕様書に対応）
import { z } from "zod";

/** 待ち時間の範囲（ミリ秒）。API 仕様書 6 章の PUT /devices/{id}/settings のルール */
export const PAUSE_MIN_MS = 200;
export const PAUSE_MAX_MS = 5000;

const pauseMs = z.number().int().min(PAUSE_MIN_MS).max(PAUSE_MAX_MS);

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
    stillThreshold: z.number().positive().nullable(),
  })
  .refine(pauseMatchesMode, pauseModeMessage);
export type DeviceSettingsInput = z.infer<typeof deviceSettingsInputSchema>;

/** GET /device/settings のレスポンス */
export const deviceSettingsSchema = z.object({
  version: z.number().int().nonnegative(),
  mode: modeSchema,
  pause: pauseSchema.nullable(),
  stillThreshold: z.number().positive().nullable(),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

/** レップ（POST /device/sets の reps[]） */
export const repInputSchema = z.object({
  index: z.number().int().min(1),
  startOffsetMs: z.number().int().nonnegative(),
  eccentricMs: z.number().int().nonnegative().nullable(),
  pauseTargetMs: z.number().int().nonnegative().nullable(),
  pauseActualMs: z.number().int().nonnegative().nullable(),
  reactionMs: z.number().int().nonnegative().nullable(),
  isPremature: z.boolean(),
  concentricMs: z.number().int().nonnegative().nullable(),
  meanVelocityMps: z.number().nonnegative().nullable(),
  peakVelocityMps: z.number().nonnegative().nullable(),
  curveHz: z.number().int().positive().nullable(),
  velocityCurve: z.array(z.number()).max(500).nullable(),
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
  });
export type CreateSetInput = z.infer<typeof createSetInputSchema>;

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

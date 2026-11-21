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

// ---------- ユーザー認証（API 仕様書 3 章） ----------

/** POST /auth/refresh のレスポンス。リフレッシュトークンは Cookie で返るのでここには入らない */
export const accessTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  /** アクセストークンの残り秒数 */
  expiresIn: z.number().int().positive(),
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

/** GET /me のレスポンス */
export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
});
export type Me = z.infer<typeof meSchema>;

/**
 * ログインに失敗したときに /login?error=<code> に付くコード
 * - oauth_denied：Google の画面でキャンセルした
 * - oauth_state_mismatch：state が一致しない（CSRF の疑い、または 10 分以上かかった）
 * - oauth_failed：Google とのやり取りに失敗した
 */
export const LOGIN_ERROR_CODES = ["oauth_denied", "oauth_state_mismatch", "oauth_failed"] as const;
export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

// ---------- ペアリング（API 仕様書 4 章、RFC 8628） ----------

/**
 * userCode に使う文字（RFC 8628 6.1 の推奨：母音と、0/O・1/I のような紛らわしい文字を除いた子音 20 文字）。
 * 母音がないので、たまたま単語になることもない
 */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_LENGTH = 8;

/**
 * 人が入力した userCode を DB の形（大文字 8 文字、ハイフンなし）にそろえる。
 * 大文字小文字・ハイフン・空白の違いは区別しない（API 仕様書 4 章）。使えない文字があれば null
 */
export function normalizeUserCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== USER_CODE_LENGTH) return null;
  for (const ch of code) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** 表示用の形（BCDF-GHJK） */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** POST /device/authorize のリクエスト */
export const deviceAuthorizeInputSchema = z.object({
  firmwareVersion: z.string().max(32).optional(),
});

/** POST /device/authorize のレスポンス */
export const deviceAuthorizeResponseSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.url(),
  verificationUriComplete: z.url(),
  expiresIn: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceAuthorizeResponse = z.infer<typeof deviceAuthorizeResponseSchema>;

export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** POST /device/token のリクエスト */
export const deviceTokenInputSchema = z.object({
  grantType: z.string(),
  deviceCode: z.string().min(1).max(100),
});

/** POST /device/token の 200 レスポンス（トークンはこの 1 回だけ返す） */
export const deviceTokenResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  deviceId: z.uuid(),
});
export type DeviceTokenResponse = z.infer<typeof deviceTokenResponseSchema>;

/** POST /device/token の 400 レスポンスの error（RFC 8628 3.5、RFC 6749 5.2） */
export const DEVICE_TOKEN_ERRORS = [
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
  "invalid_grant",
  "invalid_request",
  "unsupported_grant_type",
] as const;
export const deviceTokenErrorSchema = z.object({ error: z.enum(DEVICE_TOKEN_ERRORS) });

export const deviceNameSchema = z.string().trim().min(1).max(50);

/** POST /pairings/approve のリクエスト */
export const approvePairingInputSchema = z.object({
  userCode: z.string().max(20),
  deviceName: deviceNameSchema,
});
export type ApprovePairingInput = z.infer<typeof approvePairingInputSchema>;

/** POST /pairings/deny のリクエスト */
export const denyPairingInputSchema = z.object({ userCode: z.string().max(20) });

export const approvePairingResultSchema = z.object({ deviceId: z.uuid() });

// ---------- デバイス管理・設定（API 仕様書 6 章） ----------

/** GET /devices の 1 件 */
export const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  lastSeenAt: z.iso.datetime().nullable(),
  /** 有効なデバイストークンがあるか */
  active: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Device = z.infer<typeof deviceSchema>;
export const deviceListSchema = z.object({ items: z.array(deviceSchema) });

/** PATCH /devices/{deviceId} のリクエスト（名前は前後の空白を落として 1〜50 文字） */
export const renameDeviceInputSchema = z.object({ name: deviceNameSchema });
export type RenameDeviceInput = z.infer<typeof renameDeviceInputSchema>;

/** GET・PUT /devices/{deviceId}/settings のレスポンス */
export const deviceSettingsDetailSchema = deviceSettingsSchema.extend({
  updatedAt: z.iso.datetime(),
});
export type DeviceSettingsDetail = z.infer<typeof deviceSettingsDetailSchema>;

// ---------- 練習日（API 仕様書 6 章） ----------

/** GET /sessions の limit（既定 20、最大 50） */
export const SESSION_LIST_DEFAULT_LIMIT = 20;
export const SESSION_LIST_MAX_LIMIT = 50;

/** 練習日の日付（日本時間、例 "2026-11-15"） */
const sessionDate = z.iso.date();

/** GET /sessions の 1 件 */
export const sessionSummarySchema = z.object({
  id: z.uuid(),
  date: sessionDate,
  /** 削除していないセットの数（1 以上。0 件の練習日は一覧に出さない） */
  setCount: z.number().int().positive(),
  repCount: z.number().int().nonnegative(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionListSchema = z.object({
  items: z.array(sessionSummarySchema),
  /** 続きを取るときに cursor に渡す。最後のページなら null */
  nextCursor: z.string().nullable(),
});
export type SessionList = z.infer<typeof sessionListSchema>;

/** GET /sessions/{id} のレップ（速度カーブは重いので含めない） */
export const repSummarySchema = z.object({
  index: z.number().int().positive(),
  meanVelocityMps: z.number().nullable(),
  peakVelocityMps: z.number().nullable(),
  /** 合図より前に挙げた（自動合図モードだけ true になりうる） */
  isPremature: z.boolean(),
  pauseActualMs: z.number().int().nullable(),
  reactionMs: z.number().int().nullable(),
});
export type RepSummary = z.infer<typeof repSummarySchema>;

/** GET /sessions/{id} のセット */
export const sessionSetSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  mode: modeSchema,
  weightKg: z.number().nullable(),
  rpe: z.number().nullable(),
  note: z.string().nullable(),
  repCount: z.number().int().nonnegative(),
  reps: z.array(repSummarySchema),
});
export type SessionSet = z.infer<typeof sessionSetSchema>;

/** GET /sessions/{id} のレスポンス。セットは古い順（その日に挙げた順） */
export const sessionDetailSchema = z.object({
  id: z.uuid(),
  date: sessionDate,
  sets: z.array(sessionSetSchema),
});
export type SessionDetail = z.infer<typeof sessionDetailSchema>;

// ---------- セットの詳細（API 仕様書 6 章、FR-V02・V08） ----------

/** GET /sets/{id} のレップ。デバイスが送った項目をすべて返す（速度カーブを含む） */
export const repDetailSchema = repSummarySchema.extend({
  /** セットの開始からこのレップの開始までの時間 */
  startOffsetMs: z.number().int(),
  /** 下ろす時間 */
  eccentricMs: z.number().int().nullable(),
  /** 合図までの待ち時間（設定から決まった目標の値） */
  pauseTargetMs: z.number().int().nullable(),
  /** 挙げる時間 */
  concentricMs: z.number().int().nullable(),
  /** 速度カーブのサンプリング周波数 */
  curveHz: z.number().int().nullable(),
  /** 挙げている間の速度（m/s）の時系列 */
  velocityCurve: z.array(z.number()).nullable(),
});
export type RepDetail = z.infer<typeof repDetailSchema>;

/** GET /sets/{id} のレスポンス */
export const setDetailSchema = sessionSetSchema.extend({
  sessionId: z.uuid(),
  endedAt: z.iso.datetime(),
  /** そのセットで使った待ち時間の設定（回数記録モードなら null） */
  pause: pauseSchema.nullable(),
  /** センサーの生データが届いているか */
  hasRawData: z.boolean(),
  reps: z.array(repDetailSchema),
});
export type SetDetail = z.infer<typeof setDetailSchema>;

// ---------- 新しく届いたセット（練習中の自動更新、FR-V07） ----------

/** GET /sets?createdAfter= の 1 件 */
export const newSetSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  startedAt: z.iso.datetime(),
  mode: modeSchema,
  repCount: z.number().int().nonnegative(),
  weightKg: z.number().nullable(),
});
export type NewSet = z.infer<typeof newSetSchema>;

/** GET /sets?createdAfter= のレスポンス */
export const newSetListSchema = z.object({
  /** createdAfter より後にサーバに届いたセット（届いた順） */
  items: z.array(newSetSchema),
  /** 次の問い合わせの createdAfter にそのまま渡す時刻（サーバの時計） */
  serverTime: z.iso.datetime(),
});
export type NewSetList = z.infer<typeof newSetListSchema>;

// ---------- セットの開始・終了の指示（ADR-0011、FR-V11） ----------

/** GET・PUT /devices/{deviceId}/recording のレスポンス（Web アプリ向け） */
export const recordingStateSchema = z.object({
  recording: z.boolean(),
  /** 開始・終了のボタンを押すたびに +1（一度も押していなければ 0） */
  seq: z.number().int().nonnegative(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  /** デバイスが受け取った番号。seq と同じなら「デバイスに伝わった」 */
  ackedSeq: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime().nullable(),
});
export type RecordingState = z.infer<typeof recordingStateSchema>;

/** PUT /devices/{deviceId}/recording のリクエスト */
export const setRecordingInputSchema = z.object({ recording: z.boolean() });
export type SetRecordingInput = z.infer<typeof setRecordingInputSchema>;

/** GET・PUT /device/recording のレスポンス（ESP32 向け） */
export const deviceRecordingSchema = z.object({
  recording: z.boolean(),
  seq: z.number().int().nonnegative(),
  startedAt: z.iso.datetime().nullable(),
  stoppedAt: z.iso.datetime().nullable(),
  /** サーバの時刻（ESP32 の時計のずれを確かめるため） */
  serverTime: z.iso.datetime(),
});
export type DeviceRecording = z.infer<typeof deviceRecordingSchema>;

/** PUT /device/recording のリクエスト。ESP32 は自分で止めることしかできない */
export const deviceStopRecordingInputSchema = z.object({
  recording: z.literal(false),
  seq: z.number().int().nonnegative().max(2_147_483_647),
});
export type DeviceStopRecordingInput = z.infer<typeof deviceStopRecordingInputSchema>;

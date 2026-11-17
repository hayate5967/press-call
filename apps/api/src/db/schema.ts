// Drizzle のテーブル定義（docs/data-design.md の 11 テーブル）
// - TypeScript 側は camelCase、DB の列名は snake_case で明示する
// - トークン類は平文を持たず、SHA-256 ハッシュの列だけを持つ
// - 種類を表す列は text にし、入る値を CHECK 制約で絞る
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- 共通の部品 ----------

/** PostgreSQL の bytea（バイナリ）。Drizzle に組み込みの型がないので自作する */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    // pg は Buffer、PGlite は Uint8Array で返す。どちらも Uint8Array にそろえる
    return new Uint8Array(value);
  },
});

/** 主キー。DB 側で gen_random_uuid() により自動生成する */
const id = () => uuid("id").primaryKey().defaultRandom();

/** タイムゾーン付きの日時 */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** 作成日時（自動で現在時刻が入る） */
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const MODES = ["auto_signal", "count_only"] as const;
export const PAUSE_MODES = ["fixed", "random"] as const;
export const DEVICE_AUTHORIZATION_STATUSES = ["pending", "approved", "denied", "consumed"] as const;

/** `列 IN ('a', 'b')` の SQL を作る（CHECK 制約用） */
const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

/**
 * mode と待ち時間の列の組み合わせのルール（device_settings と sets で共通）
 * - count_only（回数記録）：待ち時間の列はすべて空
 * - auto_signal ＋ fixed：pause_fixed_ms だけ必須
 * - auto_signal ＋ random：pause_min_ms と pause_max_ms が必須で、min ≦ max
 */
const pauseConsistency = (t: {
  mode: AnyPgColumn;
  pauseMode: AnyPgColumn;
  pauseFixedMs: AnyPgColumn;
  pauseMinMs: AnyPgColumn;
  pauseMaxMs: AnyPgColumn;
}) => sql`(
  ${t.mode} = 'count_only'
  AND ${t.pauseMode} IS NULL AND ${t.pauseFixedMs} IS NULL
  AND ${t.pauseMinMs} IS NULL AND ${t.pauseMaxMs} IS NULL
) OR (
  ${t.mode} = 'auto_signal' AND ${t.pauseMode} = 'fixed'
  AND ${t.pauseFixedMs} IS NOT NULL
  AND ${t.pauseMinMs} IS NULL AND ${t.pauseMaxMs} IS NULL
) OR (
  ${t.mode} = 'auto_signal' AND ${t.pauseMode} = 'random'
  AND ${t.pauseFixedMs} IS NULL
  AND ${t.pauseMinMs} IS NOT NULL AND ${t.pauseMaxMs} IS NOT NULL
  AND ${t.pauseMinMs} <= ${t.pauseMaxMs}
)`;

// ---------- 認証まわり ----------

export const users = pgTable("users", {
  id: id(),
  /** Google から取得したメール。表示用で、本人確認には使わない */
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: createdAt(),
});

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** いまは 'google' だけ */
    provider: text("provider").notNull(),
    /** ID トークンの sub。本人の特定にはメールではなくこれを使う */
    providerSubject: text("provider_subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("oauth_accounts_provider_subject_key").on(t.provider, t.providerSubject)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** 同じログインから交換され続けたトークンの系統。盗難検知時は系統ごと失効 */
    familyId: uuid("family_id").notNull(),
    /** トークンの SHA-256 ハッシュ（平文は保存しない） */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamptz("expires_at").notNull(),
    /** 交換に使われた日時。値があるトークンが再び来たら盗難とみなす */
    usedAt: timestamptz("used_at"),
    revokedAt: timestamptz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_family_id_idx").on(t.familyId)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    lastSeenAt: timestamptz("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [index("devices_user_id_idx").on(t.userId)],
);

export const deviceTokens = pgTable("device_tokens", {
  id: id(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id),
  /** トークンの SHA-256 ハッシュ（平文は保存しない） */
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamptz("last_used_at"),
  revokedAt: timestamptz("revoked_at"),
  createdAt: createdAt(),
});

/** ペアリング（RFC 8628）の途中状態。期限は 10 分 */
export const deviceAuthorizations = pgTable(
  "device_authorizations",
  {
    id: id(),
    /** ESP32 だけが知る deviceCode の SHA-256 ハッシュ */
    deviceCodeHash: text("device_code_hash").notNull().unique(),
    /** 人が入力する 8 文字のコード */
    userCode: text("user_code").notNull().unique(),
    status: text("status", { enum: DEVICE_AUTHORIZATION_STATUSES }).notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    lastPolledAt: timestamptz("last_polled_at"),
    /** 許可したユーザー（許可されるまで空） */
    userId: uuid("user_id").references(() => users.id),
    /** 許可時に作られたデバイス */
    deviceId: uuid("device_id").references(() => devices.id),
    deviceName: text("device_name"),
    createdAt: createdAt(),
  },
  (t) => [
    check("device_authorizations_status_check", oneOf(t.status, DEVICE_AUTHORIZATION_STATUSES)),
  ],
);

// ---------- デバイスの設定 ----------

/** Web アプリで変更し、ESP32 が取りに来る「今の設定」。1 デバイス 1 行 */
export const deviceSettings = pgTable(
  "device_settings",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => devices.id),
    mode: text("mode", { enum: MODES }).notNull(),
    pauseMode: text("pause_mode", { enum: PAUSE_MODES }),
    pauseFixedMs: integer("pause_fixed_ms"),
    pauseMinMs: integer("pause_min_ms"),
    pauseMaxMs: integer("pause_max_ms"),
    /** 空ならファームの既定値を使う */
    stillThreshold: real("still_threshold"),
    /** 更新のたびに +1。ESP32 の If-None-Match に使う */
    version: integer("version").notNull().default(1),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("device_settings_mode_check", oneOf(t.mode, MODES)),
    check("device_settings_pause_check", pauseConsistency(t)),
    // API 仕様：待ち時間は 200〜5000ms
    check(
      "device_settings_pause_range_check",
      sql`(${t.pauseFixedMs} IS NULL OR ${t.pauseFixedMs} BETWEEN 200 AND 5000)
        AND (${t.pauseMinMs} IS NULL OR ${t.pauseMinMs} BETWEEN 200 AND 5000)
        AND (${t.pauseMaxMs} IS NULL OR ${t.pauseMaxMs} BETWEEN 200 AND 5000)`,
    ),
  ],
);

// ---------- 記録まわり ----------

/** 練習日。同じ日（日本時間）のセットは 1 つにまとまる */
export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionDate: date("session_date", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("training_sessions_user_id_session_date_key").on(t.userId, t.sessionDate)],
);

export const sets = pgTable(
  "sets",
  {
    id: id(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    /** デバイスが作る冪等キー。(device_id, client_set_id) で重複を防ぐ */
    clientSetId: uuid("client_set_id").notNull(),
    // そのセットで使った設定（device_settings からのコピー）
    mode: text("mode", { enum: MODES }).notNull(),
    pauseMode: text("pause_mode", { enum: PAUSE_MODES }),
    pauseFixedMs: integer("pause_fixed_ms"),
    pauseMinMs: integer("pause_min_ms"),
    pauseMaxMs: integer("pause_max_ms"),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at").notNull(),
    // 重量・RPE は誤差の出ない numeric。JS では number として扱う
    weightKg: numeric("weight_kg", { precision: 5, scale: 1, mode: "number" }),
    rpe: numeric("rpe", { precision: 3, scale: 1, mode: "number" }),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    /** 削除日時。行は残し、同じ clientSetId の再送で復活させない */
    deletedAt: timestamptz("deleted_at"),
  },
  (t) => [
    unique("sets_device_id_client_set_id_key").on(t.deviceId, t.clientSetId),
    index("sets_session_id_idx").on(t.sessionId),
    check("sets_mode_check", oneOf(t.mode, MODES)),
    check("sets_pause_check", pauseConsistency(t)),
    check("sets_time_order_check", sql`${t.startedAt} <= ${t.endedAt}`),
    check("sets_weight_kg_check", sql`${t.weightKg} BETWEEN 0 AND 500`),
    check("sets_rpe_check", sql`${t.rpe} BETWEEN 1 AND 10`),
  ],
);

export const reps = pgTable(
  "reps",
  {
    id: id(),
    setId: uuid("set_id")
      .notNull()
      .references(() => sets.id, { onDelete: "cascade" }),
    /** 何レップ目か（1 始まり） */
    repIndex: smallint("rep_index").notNull(),
    startOffsetMs: integer("start_offset_ms").notNull(),
    eccentricMs: integer("eccentric_ms"),
    pauseTargetMs: integer("pause_target_ms"),
    pauseActualMs: integer("pause_actual_ms"),
    reactionMs: integer("reaction_ms"),
    isPremature: boolean("is_premature").notNull().default(false),
    concentricMs: integer("concentric_ms"),
    meanVelocityMps: real("mean_velocity_mps"),
    peakVelocityMps: real("peak_velocity_mps"),
    curveHz: smallint("curve_hz"),
    /** 挙上中の速度の時系列（real[]） */
    velocityCurve: real("velocity_curve").array(),
  },
  (t) => [
    unique("reps_set_id_rep_index_key").on(t.setId, t.repIndex),
    check("reps_rep_index_check", sql`${t.repIndex} >= 1`),
  ],
);

/** センサーの生データ（ADR-0009）。一覧で読み込まないよう別テーブル */
export const setRawData = pgTable("set_raw_data", {
  setId: uuid("set_id")
    .primaryKey()
    .references(() => sets.id, { onDelete: "cascade" }),
  sampleRateHz: smallint("sample_rate_hz").notNull(),
  formatVersion: smallint("format_version").notNull(),
  byteSize: integer("byte_size").notNull(),
  payload: bytea("payload").notNull(),
  createdAt: createdAt(),
});

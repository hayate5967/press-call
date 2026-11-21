// スキーマのテスト：生成したマイグレーションを PGlite（メモリ上の PostgreSQL）に流し、
// 制約（UNIQUE・CHECK・CASCADE）が本当に効くかを確かめる。Neon には接続しない
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";

const client = new PGlite();
const db = drizzle({ client, schema });

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url).href),
  });
});

/** 失敗したクエリが、指定した名前の制約に違反しているかを確かめる */
async function expectViolation(query: Promise<unknown>, constraint: string) {
  const error = await query.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `${constraint} の違反になるはず`).toBeInstanceOf(Error);
  // Drizzle は DB のエラーを cause に入れて包む
  const cause = (error as Error & { cause?: Error }).cause ?? (error as Error);
  expect(cause.message).toContain(constraint);
}

// ---------- テスト用のデータを作る関数 ----------

async function createUser() {
  const [user] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  if (!user) throw new Error("user が作れない");
  return user;
}

async function createDevice() {
  const user = await createUser();
  const [device] = await db
    .insert(schema.devices)
    .values({ userId: user.id, name: "部室のベンチ" })
    .returning();
  if (!device) throw new Error("device が作れない");
  return { user, device };
}

async function createSessionAndDevice() {
  const { user, device } = await createDevice();
  const [session] = await db
    .insert(schema.trainingSessions)
    .values({ userId: user.id, sessionDate: "2026-11-15" })
    .returning();
  if (!session) throw new Error("session が作れない");
  return { user, device, session };
}

const baseSet = {
  mode: "auto_signal" as const,
  pauseMode: "fixed" as const,
  pauseFixedMs: 1000,
  startedAt: new Date("2026-11-15T09:30:12.400Z"),
  endedAt: new Date("2026-11-15T09:30:41.900Z"),
};

async function createSet(overrides: Partial<typeof schema.sets.$inferInsert> = {}) {
  const { session, device } = await createSessionAndDevice();
  const [set] = await db
    .insert(schema.sets)
    .values({
      sessionId: session.id,
      deviceId: device.id,
      clientSetId: crypto.randomUUID(),
      ...baseSet,
      ...overrides,
    })
    .returning();
  if (!set) throw new Error("set が作れない");
  return { set, session, device };
}

// ---------- テスト ----------

describe("マイグレーション", () => {
  it("12 テーブルが作られる", async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "device_authorizations",
      "device_recordings",
      "device_settings",
      "device_tokens",
      "devices",
      "oauth_accounts",
      "refresh_tokens",
      "reps",
      "set_raw_data",
      "sets",
      "training_sessions",
      "users",
    ]);
  });

  it("トークン類は平文の列を持たず、ハッシュの列だけを持つ", async () => {
    const result = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('refresh_tokens', 'device_tokens', 'device_authorizations')
         AND (column_name LIKE '%token%' OR column_name LIKE '%code%')
       ORDER BY table_name, column_name`,
    );
    expect(result.rows).toEqual([
      { table_name: "device_authorizations", column_name: "device_code_hash" },
      // user_code は人が入力する短いコード。秘密ではないので平文で持つ（データ設計どおり）
      { table_name: "device_authorizations", column_name: "user_code" },
      { table_name: "device_tokens", column_name: "token_hash" },
      { table_name: "refresh_tokens", column_name: "token_hash" },
    ]);
  });
});

describe("UNIQUE 制約", () => {
  it("同じ Google アカウント（provider, sub）は 2 回紐づけられない", async () => {
    const user = await createUser();
    const row = { userId: user.id, provider: "google", providerSubject: "sub-123" };
    await db.insert(schema.oauthAccounts).values(row);
    await expectViolation(
      db.insert(schema.oauthAccounts).values(row),
      "oauth_accounts_provider_subject_key",
    );
  });

  it("同じユーザーの同じ日の練習日は 1 つだけ", async () => {
    const { user } = await createSessionAndDevice();
    await expectViolation(
      db.insert(schema.trainingSessions).values({ userId: user.id, sessionDate: "2026-11-15" }),
      "training_sessions_user_id_session_date_key",
    );
  });

  it("同じデバイスの同じ clientSetId は 2 行にならない（冪等キー）", async () => {
    const { set } = await createSet();
    await expectViolation(
      db.insert(schema.sets).values({ ...set, id: undefined }),
      "sets_device_id_client_set_id_key",
    );
  });

  it("onConflictDoNothing なら再送しても 1 行のまま", async () => {
    const { set } = await createSet();
    const inserted = await db
      .insert(schema.sets)
      .values({ ...set, id: undefined })
      .onConflictDoNothing({ target: [schema.sets.deviceId, schema.sets.clientSetId] })
      .returning();
    expect(inserted).toEqual([]);
  });

  it("同じセットに同じ rep_index は入らない", async () => {
    const { set } = await createSet();
    const rep = { setId: set.id, repIndex: 1, startOffsetMs: 1200 };
    await db.insert(schema.reps).values(rep);
    await expectViolation(db.insert(schema.reps).values(rep), "reps_set_id_rep_index_key");
  });

  it("リフレッシュトークンのハッシュは重複しない", async () => {
    const user = await createUser();
    const row = {
      userId: user.id,
      familyId: crypto.randomUUID(),
      tokenHash: "hash-dup",
      expiresAt: new Date("2026-12-15T00:00:00Z"),
    };
    await db.insert(schema.refreshTokens).values(row);
    await expectViolation(
      db.insert(schema.refreshTokens).values(row),
      "refresh_tokens_token_hash_unique",
    );
  });
});

describe("CHECK 制約：mode と待ち時間の組み合わせ（sets）", () => {
  it("count_only で待ち時間がすべて空なら入る", async () => {
    const { set } = await createSet({ mode: "count_only", pauseMode: null, pauseFixedMs: null });
    expect(set.mode).toBe("count_only");
  });

  it("random で min ≦ max なら入る", async () => {
    const { set } = await createSet({
      pauseMode: "random",
      pauseFixedMs: null,
      pauseMinMs: 500,
      pauseMaxMs: 1500,
    });
    expect(set.pauseMinMs).toBe(500);
  });

  it.each([
    ["count_only なのに待ち時間がある", { mode: "count_only" as const }],
    ["auto_signal なのに pause_mode がない", { pauseMode: null, pauseFixedMs: null }],
    ["fixed なのに pause_fixed_ms がない", { pauseFixedMs: null }],
    ["fixed なのに min/max がある", { pauseMinMs: 500, pauseMaxMs: 1500 }],
    [
      "random なのに min > max",
      { pauseMode: "random" as const, pauseFixedMs: null, pauseMinMs: 2000, pauseMaxMs: 500 },
    ],
  ])("%s → 違反", async (_, overrides) => {
    await expectViolation(createSet(overrides), "sets_pause_check");
  });

  it("mode に決まった値以外は入らない", async () => {
    await expectViolation(
      createSet({ mode: "other" as "count_only", pauseMode: null, pauseFixedMs: null }),
      "sets_mode_check",
    );
  });
});

describe("CHECK 制約：sets のその他", () => {
  it("started_at > ended_at は入らない", async () => {
    await expectViolation(
      createSet({ startedAt: baseSet.endedAt, endedAt: baseSet.startedAt }),
      "sets_time_order_check",
    );
  });

  it("重量は 0〜500、RPE は 1〜10", async () => {
    const { set } = await createSet({ weightKg: 102.5, rpe: 8.5 });
    expect(set.weightKg).toBe(102.5);
    expect(set.rpe).toBe(8.5);
    await expectViolation(createSet({ weightKg: -1 }), "sets_weight_kg_check");
    await expectViolation(createSet({ rpe: 11 }), "sets_rpe_check");
  });

  it("rep_index は 1 以上", async () => {
    const { set } = await createSet();
    await expectViolation(
      db.insert(schema.reps).values({ setId: set.id, repIndex: 0, startOffsetMs: 0 }),
      "reps_rep_index_check",
    );
  });
});

describe("CHECK 制約：device_settings", () => {
  it("正しい設定は入り、version は 1 から始まる", async () => {
    const { device } = await createDevice();
    const [settings] = await db
      .insert(schema.deviceSettings)
      .values({ deviceId: device.id, mode: "auto_signal", pauseMode: "fixed", pauseFixedMs: 1000 })
      .returning();
    expect(settings?.version).toBe(1);
  });

  it("random で min > max は入らない", async () => {
    const { device } = await createDevice();
    await expectViolation(
      db.insert(schema.deviceSettings).values({
        deviceId: device.id,
        mode: "auto_signal",
        pauseMode: "random",
        pauseMinMs: 3000,
        pauseMaxMs: 1000,
      }),
      "device_settings_pause_check",
    );
  });

  it("待ち時間は 200〜5000ms", async () => {
    const { device } = await createDevice();
    await expectViolation(
      db.insert(schema.deviceSettings).values({
        deviceId: device.id,
        mode: "auto_signal",
        pauseMode: "fixed",
        pauseFixedMs: 100,
      }),
      "device_settings_pause_range_check",
    );
  });
});

describe("CHECK 制約：device_authorizations", () => {
  it("status に決まった値以外は入らない", async () => {
    await expectViolation(
      db.insert(schema.deviceAuthorizations).values({
        deviceCodeHash: "dc-hash",
        userCode: "BCDF-GHJK",
        status: "unknown" as "pending",
        expiresAt: new Date("2026-11-15T09:40:00Z"),
      }),
      "device_authorizations_status_check",
    );
  });
});

describe("型と削除の動き", () => {
  it("速度カーブ（real[]）と生データ（bytea）を読み書きできる", async () => {
    const { set } = await createSet();
    await db.insert(schema.reps).values({
      setId: set.id,
      repIndex: 1,
      startOffsetMs: 1200,
      velocityCurve: [0, 0.25, 0.5],
    });
    const payload = new Uint8Array([1, 0, 255, 127]);
    await db
      .insert(schema.setRawData)
      .values({ setId: set.id, sampleRateHz: 100, formatVersion: 1, byteSize: 4, payload });

    const [rep] = await db.select().from(schema.reps).where(eq(schema.reps.setId, set.id));
    expect(rep?.velocityCurve).toEqual([0, 0.25, 0.5]);
    const [raw] = await db
      .select()
      .from(schema.setRawData)
      .where(eq(schema.setRawData.setId, set.id));
    expect(raw?.payload).toEqual(payload);
  });

  it("セットを消すとレップと生データも消える（CASCADE）", async () => {
    const { set } = await createSet();
    await db.insert(schema.reps).values({ setId: set.id, repIndex: 1, startOffsetMs: 0 });
    await db.insert(schema.setRawData).values({
      setId: set.id,
      sampleRateHz: 100,
      formatVersion: 1,
      byteSize: 1,
      payload: new Uint8Array([0]),
    });

    await db.delete(schema.sets).where(eq(schema.sets.id, set.id));

    expect(await db.select().from(schema.reps).where(eq(schema.reps.setId, set.id))).toEqual([]);
    expect(
      await db.select().from(schema.setRawData).where(eq(schema.setRawData.setId, set.id)),
    ).toEqual([]);
  });

  it("セットが残っている練習日は消せない", async () => {
    const { session } = await createSet();
    await expectViolation(
      db.delete(schema.trainingSessions).where(eq(schema.trainingSessions.id, session.id)),
      "sets_session_id_training_sessions_id_fk",
    );
  });
});

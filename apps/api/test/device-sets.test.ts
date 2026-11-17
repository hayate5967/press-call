import type { CreateSetInput } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db, DbUnavailableError, openDb } from "../src/db/client";
import { reps, sets, trainingSessions } from "../src/db/schema";
import { createApp, app as productionApp } from "../src/index";
import { toSessionDate } from "../src/services/sets";
import { createTestApp, createTestDb, seedDevice } from "./helpers/db";

type Result = { setId: string; sessionId: string; created: boolean };
type Problem = { type: string; status: number; code: string; errors?: { path: string }[] };

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let env: { ENVIRONMENT: "development"; DEV_DEVICE_ID: string };

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  const { deviceId } = await seedDevice(db);
  env = { ENVIRONMENT: "development", DEV_DEVICE_ID: deviceId };
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  // 記録だけ消して、ユーザーとデバイスは残す
  await db.execute(sql`truncate table set_raw_data, reps, sets, training_sessions`);
});

function makeSet(overrides: Partial<CreateSetInput> = {}): CreateSetInput {
  return {
    clientSetId: crypto.randomUUID(),
    settingsVersion: 4,
    mode: "auto_signal",
    pause: { mode: "random", minMs: 500, maxMs: 1500 },
    startedAt: "2026-11-15T09:30:12.400Z",
    endedAt: "2026-11-15T09:30:41.900Z",
    reps: [1, 2].map((index) => ({
      index,
      startOffsetMs: 1200 * index,
      eccentricMs: 950,
      pauseTargetMs: 1130,
      pauseActualMs: 1190,
      reactionMs: 240,
      isPremature: false,
      concentricMs: 1050,
      meanVelocityMps: 0.42,
      peakVelocityMps: 0.71,
      curveHz: 100,
      velocityCurve: [0, 0.08, 0.21, 0.35],
    })),
    ...overrides,
  };
}

function post(body: unknown, e: Record<string, unknown> = env) {
  return app.request(
    "/api/v1/device/sets",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    e,
  );
}

async function countRows() {
  const [s] = await db.select({ n: sql<number>`count(*)::int` }).from(sets);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(reps);
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(trainingSessions);
  return { sets: s?.n, reps: r?.n, sessions: t?.n };
}

describe("POST /api/v1/device/sets：正常系", () => {
  it("初めてのセットは 201・created: true で、セットとレップが保存される", async () => {
    const input = makeSet();
    const res = await post(input);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Result;
    expect(body.created).toBe(true);

    const [row] = await db.select().from(sets).where(eq(sets.id, body.setId));
    expect(row).toMatchObject({
      sessionId: body.sessionId,
      deviceId: env.DEV_DEVICE_ID,
      clientSetId: input.clientSetId,
      mode: "auto_signal",
      pauseMode: "random",
      pauseFixedMs: null,
      pauseMinMs: 500,
      pauseMaxMs: 1500,
    });
    expect(row?.startedAt.toISOString()).toBe(input.startedAt);

    const savedReps = await db
      .select()
      .from(reps)
      .where(eq(reps.setId, body.setId))
      .orderBy(reps.repIndex);
    expect(savedReps.map((r) => r.repIndex)).toEqual([1, 2]);
    expect(savedReps[0]?.velocityCurve).toEqual([0, 0.08, 0.21, 0.35]);
  });

  it("回数記録モード（pause なし）のセットも登録できる", async () => {
    const base = makeSet();
    const input = makeSet({
      mode: "count_only",
      pause: null,
      reps: base.reps.map((r) => ({ ...r, pauseTargetMs: null, reactionMs: null })),
    });
    const res = await post(input);
    expect(res.status).toBe(201);
    const [row] = await db.select().from(sets);
    expect(row).toMatchObject({ mode: "count_only", pauseMode: null, pauseFixedMs: null });
  });

  it("同じ日（日本時間）のセットは同じ練習日にまとまる", async () => {
    const a = (await (await post(makeSet())).json()) as Result;
    const b = (await (
      await post(
        makeSet({ startedAt: "2026-11-15T10:00:00.000Z", endedAt: "2026-11-15T10:00:30.000Z" }),
      )
    ).json()) as Result;
    expect(b.sessionId).toBe(a.sessionId);
    expect(await countRows()).toMatchObject({ sets: 2, sessions: 1 });

    const [session] = await db.select().from(trainingSessions);
    expect(session?.sessionDate).toBe("2026-11-15");
  });

  it("日本時間で日付が変わると別の練習日になる（UTC 15:00 = 日本時間 0:00）", async () => {
    const a = (await (
      await post(
        makeSet({ startedAt: "2026-11-15T14:59:00.000Z", endedAt: "2026-11-15T14:59:30.000Z" }),
      )
    ).json()) as Result;
    const b = (await (
      await post(
        makeSet({ startedAt: "2026-11-15T15:00:00.000Z", endedAt: "2026-11-15T15:00:30.000Z" }),
      )
    ).json()) as Result;
    expect(b.sessionId).not.toBe(a.sessionId);
    const dates = (await db.select().from(trainingSessions)).map((s) => s.sessionDate).sort();
    expect(dates).toEqual(["2026-11-15", "2026-11-16"]);
  });
});

describe("POST /api/v1/device/sets：real の精度", () => {
  it("real で表せないほど 0 に近い値は 0 として保存する（DB エラーにしない）", async () => {
    const input = makeSet();
    const tinyReps = input.reps.map((r) => ({
      ...r,
      meanVelocityMps: 1e-50,
      velocityCurve: [0.5, 1e-50, -1e-50],
    }));
    const res = await post({ ...input, reps: tinyReps });
    expect(res.status).toBe(201);
    const [rep] = await db.select().from(reps).orderBy(reps.repIndex).limit(1);
    expect(rep?.meanVelocityMps).toBe(0);
    expect(rep?.velocityCurve?.map((v) => Math.abs(v))).toEqual([0.5, 0, 0]);
  });
});

describe("POST /api/v1/device/sets：重複送信（冪等）", () => {
  it("同じ clientSetId を 2 回送ると、2 回目は 200・created: false で同じ ID を返し、行は増えない", async () => {
    const input = makeSet();
    const first = (await (await post(input)).json()) as Result;

    const res = await post(input);
    expect(res.status).toBe(200);
    const second = (await res.json()) as Result;
    expect(second).toEqual({ setId: first.setId, sessionId: first.sessionId, created: false });
    expect(await countRows()).toEqual({ sets: 1, reps: 2, sessions: 1 });
  });

  it("再送で中身が違っていても、最初に登録した内容は更新しない", async () => {
    const input = makeSet();
    await post(input);
    const changed = {
      ...input,
      reps: input.reps.slice(0, 1),
      pause: { mode: "fixed", fixedMs: 900 },
    };
    const res = await post(changed);
    expect(res.status).toBe(200);

    const [row] = await db.select().from(sets);
    expect(row?.pauseMode).toBe("random");
    expect(await countRows()).toMatchObject({ sets: 1, reps: 2 });
  });

  it("同じセットが同時に 2 つ届いても 1 行にしかならない", async () => {
    const input = makeSet();
    const results = await Promise.all([post(input), post(input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    const bodies = (await Promise.all(results.map((r) => r.json()))) as Result[];
    expect(bodies[0]?.setId).toBe(bodies[1]?.setId);
    expect(await countRows()).toEqual({ sets: 1, reps: 2, sessions: 1 });
  });

  it("削除済みのセットが再送されても復活させず、200・created: false を返す", async () => {
    const input = makeSet();
    const first = (await (await post(input)).json()) as Result;
    await db.update(sets).set({ deletedAt: new Date() }).where(eq(sets.id, first.setId));
    await db.delete(reps).where(eq(reps.setId, first.setId));

    const res = await post(input);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Result).setId).toBe(first.setId);
    const [row] = await db.select().from(sets);
    expect(row?.deletedAt).not.toBeNull();
    expect(await countRows()).toMatchObject({ sets: 1, reps: 0 });
  });
});

describe("POST /api/v1/device/sets：不正な入力", () => {
  async function expectProblem(res: Response, status: number, code: string) {
    expect(res.status).toBe(status);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = (await res.json()) as Problem;
    expect(body).toMatchObject({ status, code });
    expect(body.type).toMatch(/^https:\/\//);
    return body;
  }

  it("自動合図モードで pause がないと 422 validation_failed で、errors に項目名が入る", async () => {
    const body = await expectProblem(
      await post(makeSet({ pause: null })),
      422,
      "validation_failed",
    );
    expect(body.errors?.map((e) => e.path)).toContain("pause");
  });

  it("clientSetId が UUID でないと 422", async () => {
    const body = await expectProblem(
      await post({ ...makeSet(), clientSetId: "abc" }),
      422,
      "validation_failed",
    );
    expect(body.errors?.map((e) => e.path)).toContain("clientSetId");
  });

  it("DB の型に入らない値は 500 ではなく 422 になり、何も保存しない", async () => {
    const input = makeSet();
    const badReps = input.reps.map((r) => ({ ...r, curveHz: 40_000, velocityCurve: [1e39] }));
    const body = await expectProblem(
      await post({ ...input, reps: badReps }),
      422,
      "validation_failed",
    );
    expect(body.errors?.map((e) => e.path)).toEqual(
      expect.arrayContaining(["reps.0.curveHz", "reps.0.velocityCurve.0"]),
    );
    expect(await countRows()).toEqual({ sets: 0, reps: 0, sessions: 0 });
  });

  it("レップの値がおかしい（負の時間）と 422 で、レップの位置が分かる", async () => {
    const input = makeSet();
    const badReps = input.reps.map((r, i) => (i === 1 ? { ...r, concentricMs: -1 } : r));
    const body = await expectProblem(
      await post({ ...input, reps: badReps }),
      422,
      "validation_failed",
    );
    expect(body.errors?.map((e) => e.path)).toContain("reps.1.concentricMs");
  });

  it("不正な入力では何も保存しない", async () => {
    await post(makeSet({ pause: null }));
    expect(await countRows()).toEqual({ sets: 0, reps: 0, sessions: 0 });
  });

  it("JSON が壊れていると 400 bad_request", async () => {
    await expectProblem(await post("{ not json"), 400, "bad_request");
  });

  it("64KB を超えると 413 payload_too_large", async () => {
    const input = makeSet();
    const huge = { ...input, padding: "x".repeat(65 * 1024) };
    await expectProblem(await post(huge), 413, "payload_too_large");
  });

  it("仮のデバイスが設定されていないと 401 device_token_invalid", async () => {
    await expectProblem(
      await post(makeSet(), { ENVIRONMENT: "development" }),
      401,
      "device_token_invalid",
    );
  });

  it("本番（ENVIRONMENT=production）では DEV_DEVICE_ID があっても 401 で、何も保存しない", async () => {
    await expectProblem(
      await post(makeSet(), { ...env, ENVIRONMENT: "production" }),
      401,
      "device_token_invalid",
    );
    expect(await countRows()).toEqual({ sets: 0, reps: 0, sessions: 0 });
  });

  it("ENVIRONMENT が未設定でも 401（開発環境と明示したときだけ仮のデバイスが効く）", async () => {
    await expectProblem(
      await post(makeSet(), { DEV_DEVICE_ID: env.DEV_DEVICE_ID }),
      401,
      "device_token_invalid",
    );
  });

  it("存在しないデバイスだと 401 device_token_invalid", async () => {
    await expectProblem(
      await post(makeSet(), { ENVIRONMENT: "development", DEV_DEVICE_ID: crypto.randomUUID() }),
      401,
      "device_token_invalid",
    );
  });
});

describe("toSessionDate", () => {
  it("UTC の時刻を日本時間の日付にする", () => {
    expect(toSessionDate("2026-11-15T14:59:59.999Z")).toBe("2026-11-15");
    expect(toSessionDate("2026-11-15T15:00:00.000Z")).toBe("2026-11-16");
    expect(toSessionDate("2026-12-31T20:00:00.000Z")).toBe("2027-01-01");
  });
});

describe("OpenAPI", () => {
  it("/device/sets が仕様に含まれる", async () => {
    const res = await app.request("/api/v1/openapi.json");
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toContain("/device/sets");
  });
});

describe("DB の接続の失敗", () => {
  function postWith(target: { request: typeof app.request }) {
    return target.request(
      "/api/v1/device/sets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeSet()),
      },
      env,
    );
  }

  it("一時的な接続の失敗は 503 db_unavailable（ESP32 は再送する）", async () => {
    const failing = createApp({
      openDb: async () => {
        throw new DbUnavailableError();
      },
    });
    const res = await postWith(failing);
    expect(res.status).toBe(503);
    expect(((await res.json()) as Problem).code).toBe("db_unavailable");
  });

  it("設定の誤りなど、それ以外の失敗は 503 ではなく 500 internal_error", async () => {
    const broken = createApp({
      openDb: async () => {
        throw new Error("設定の誤り");
      },
    });
    const res = await postWith(broken);
    expect(res.status).toBe(500);
    expect(((await res.json()) as Problem).code).toBe("internal_error");
  });

  it("HYPERDRIVE バインディングがないと 500（503 にしない）", async () => {
    const res = await postWith(productionApp);
    expect(res.status).toBe(500);
    expect(((await res.json()) as Problem).code).toBe("internal_error");
  });

  it("接続を閉じるのに失敗しても、保存できていれば 201 を返す", async () => {
    const closeFails = createApp({
      openDb: async () => ({
        db,
        close: async () => {
          throw new Error("close に失敗");
        },
      }),
    });
    const res = await postWith(closeFails);
    expect(res.status).toBe(201);
    expect(await countRows()).toMatchObject({ sets: 1 });
  });

  it("openDb：つながらない相手への接続は DbUnavailableError になる", async () => {
    // 127.0.0.1 の 1 番ポートは通常だれも待ち受けておらず、すぐに接続を拒否される
    await expect(openDb("postgres://user:pass@127.0.0.1:1/db")).rejects.toBeInstanceOf(
      DbUnavailableError,
    );
  });
});

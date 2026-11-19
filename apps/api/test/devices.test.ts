// デバイス一覧と設定の取得・変更（Web アプリ向け）のテスト
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { devices, deviceTokens } from "../src/db/schema";
import { parseIfMatch } from "../src/routes/devices";
import { accessTokenFor, createTestApp, createTestDb, seedDevice, TEST_ENV } from "./helpers/db";

type Seeded = Awaited<ReturnType<typeof seedDevice>>;

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let alice: Seeded;
let bob: Seeded;
let aliceToken: string;
let bobToken: string;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  alice = await seedDevice(db, "alice@example.com");
  bob = await seedDevice(db, "bob@example.com");
  aliceToken = await accessTokenFor(alice.userId);
  bobToken = await accessTokenFor(bob.userId);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate table device_settings`);
  await db.update(deviceTokens).set({ revokedAt: null });
});

function request(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return app.request(
    `/api/v1${path}`,
    {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    },
    TEST_ENV,
  );
}

const FIXED_800 = {
  mode: "auto_signal",
  pause: { mode: "fixed", fixedMs: 800 },
  stillThreshold: null,
};

function put(deviceId: string, body: unknown, token = aliceToken, ifMatch?: string) {
  return request(`/devices/${deviceId}/settings`, {
    method: "PUT",
    token,
    body: JSON.stringify(body),
    ...(ifMatch ? { headers: { "If-Match": ifMatch } } : {}),
  });
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  expect(await res.json()).toMatchObject({ status, code });
}

describe("GET /devices", () => {
  it("自分のデバイスだけを返す。active は有効なトークンがあるか", async () => {
    const res = await request("/devices", { token: aliceToken });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; active: boolean }[] };
    expect(body.items.map((d) => d.id)).toEqual([alice.deviceId]);
    expect(body.items[0]?.active).toBe(true);

    await db
      .update(deviceTokens)
      .set({ revokedAt: new Date() })
      .where(eq(deviceTokens.deviceId, alice.deviceId));
    const after = (await (await request("/devices", { token: aliceToken })).json()) as {
      items: { active: boolean }[];
    };
    expect(after.items[0]?.active).toBe(false);
  });

  it("ログインしていなければ 401", async () => {
    await expectProblem(await request("/devices"), 401, "token_missing");
  });

  it("デバイストークンでは呼べない", async () => {
    await expectProblem(await request("/devices", { token: alice.token }), 401, "token_invalid");
  });
});

describe("GET /devices/{deviceId}/settings", () => {
  it("行がなければ初期設定を作って返す（ETag は version）", async () => {
    const res = await request(`/devices/${alice.deviceId}/settings`, { token: aliceToken });
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"1"');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      version: 1,
      mode: "auto_signal",
      pause: { mode: "fixed", fixedMs: 1000 },
      stillThreshold: null,
    });
    expect(typeof body.updatedAt).toBe("string");
  });

  it("他人のデバイス・存在しないデバイスは 404（区別しない）", async () => {
    await expectProblem(
      await request(`/devices/${bob.deviceId}/settings`, { token: aliceToken }),
      404,
      "not_found",
    );
    await expectProblem(
      await request(`/devices/${crypto.randomUUID()}/settings`, { token: aliceToken }),
      404,
      "not_found",
    );
  });

  it("deviceId が UUID でなければ 422", async () => {
    await expectProblem(
      await request("/devices/abc/settings", { token: aliceToken }),
      422,
      "validation_failed",
    );
  });
});

describe("PUT /devices/{deviceId}/settings", () => {
  it("置き換えて version を 1 増やす。ESP32 は次の問い合わせで新しい設定を受け取る", async () => {
    const res = await put(alice.deviceId, FIXED_800);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2"');
    expect(await res.json()).toMatchObject({ version: 2, pause: { fixedMs: 800 } });

    const fromDevice = await app.request(
      "/api/v1/device/settings",
      { headers: { Authorization: `Bearer ${alice.token}`, "If-None-Match": '"1"' } },
      TEST_ENV,
    );
    expect(fromDevice.status).toBe(200);
    expect(await fromDevice.json()).toMatchObject({ version: 2, pause: { fixedMs: 800 } });
  });

  it("回数記録モード・ランダム・しきい値も保存できる", async () => {
    const count = await put(alice.deviceId, {
      mode: "count_only",
      pause: null,
      stillThreshold: 0.05,
    });
    expect(await count.json()).toMatchObject({
      mode: "count_only",
      pause: null,
      stillThreshold: 0.05,
    });
    const random = await put(alice.deviceId, {
      mode: "auto_signal",
      pause: { mode: "random", minMs: 500, maxMs: 1500 },
      stillThreshold: null,
    });
    expect(await random.json()).toMatchObject({
      version: 3,
      pause: { mode: "random", minMs: 500, maxMs: 1500 },
    });
  });

  it("If-Match が今の version と同じなら更新、古ければ 412（変更しない）", async () => {
    expect((await put(alice.deviceId, FIXED_800, aliceToken, '"1"')).status).toBe(200);
    await expectProblem(
      await put(
        alice.deviceId,
        { ...FIXED_800, pause: { mode: "fixed", fixedMs: 900 } },
        aliceToken,
        '"1"',
      ),
      412,
      "precondition_failed",
    );
    const now = (await (
      await request(`/devices/${alice.deviceId}/settings`, { token: aliceToken })
    ).json()) as { version: number; pause: { fixedMs: number } };
    expect(now).toMatchObject({ version: 2, pause: { fixedMs: 800 } });
  });

  it("If-Match に複数の version を並べたとき、今の version が含まれていれば更新する", async () => {
    expect((await put(alice.deviceId, FIXED_800, aliceToken, '"7", "1"')).status).toBe(200);
    await expectProblem(
      await put(alice.deviceId, FIXED_800, aliceToken, '"7", "1"'),
      412,
      "precondition_failed",
    );
  });

  it("設定の行がないデバイスでも PUT できる（行を作ってから置き換える）", async () => {
    const res = await put(alice.deviceId, FIXED_800, aliceToken, '"1"');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, pause: { fixedMs: 800 } });
  });

  const invalid: [string, unknown][] = [
    ["待ち時間が 200ms 未満", { ...FIXED_800, pause: { mode: "fixed", fixedMs: 100 } }],
    ["min > max", { ...FIXED_800, pause: { mode: "random", minMs: 2000, maxMs: 1000 } }],
    ["auto_signal なのに pause が null", { ...FIXED_800, pause: null }],
    ["しきい値が 0.15 以上", { ...FIXED_800, stillThreshold: 0.15 }],
  ];
  it.each(invalid)("%s → 422（変更しない）", async (_, body) => {
    await expectProblem(await put(alice.deviceId, body), 422, "validation_failed");
    const res = await request(`/devices/${alice.deviceId}/settings`, { token: aliceToken });
    expect(((await res.json()) as { version: number }).version).toBe(1);
  });

  it("他人のデバイスは 404 で、変更もしない", async () => {
    await expectProblem(await put(bob.deviceId, FIXED_800), 404, "not_found");
    const res = await request(`/devices/${bob.deviceId}/settings`, { token: bobToken });
    expect(await res.json()).toMatchObject({ version: 1, pause: { fixedMs: 1000 } });
  });

  it("ログインしていなければ 401", async () => {
    await expectProblem(
      await request(`/devices/${alice.deviceId}/settings`, {
        method: "PUT",
        body: JSON.stringify(FIXED_800),
      }),
      401,
      "token_missing",
    );
  });
});

describe("If-Match の読み取り", () => {
  it('なし・* は条件なし、"n" は version、一致しうる値がなければ 412', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch("*")).toBeUndefined();
    expect(parseIfMatch('"4"')).toEqual([4]);
    expect(parseIfMatch('"3", "4"')).toEqual([3, 4]);
    expect(parseIfMatch('W/"3", "4"')).toEqual([4]); // 弱い ETag は強い比較で一致しない
    expect(() => parseIfMatch('W/"4"')).toThrow();
    expect(() => parseIfMatch("4")).toThrow();
  });
});

describe("devices の所有者", () => {
  it("seedDevice のデバイスは持ち主に紐づいている（テストの前提）", async () => {
    const [d] = await db.select().from(devices).where(eq(devices.id, alice.deviceId));
    expect(d?.userId).toBe(alice.userId);
  });
});

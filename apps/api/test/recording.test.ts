// セットの開始・終了の指示（ADR-0011）のテスト
// - Web アプリ：GET・PUT /devices/{deviceId}/recording
// - ESP32：GET・PUT /device/recording
import type { DeviceRecording, RecordingState } from "@press-call/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { deviceRecordings, deviceTokens } from "../src/db/schema";
import { accessTokenFor, createTestApp, createTestDb, seedDevice, TEST_ENV } from "./helpers/db";

type Seeded = Awaited<ReturnType<typeof seedDevice>>;

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createTestApp>;
let alice: Seeded;
let bob: Seeded;
let aliceToken: string;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = () => t.client.close();
  app = createTestApp(db);
  alice = await seedDevice(db, "alice@example.com");
  bob = await seedDevice(db, "bob@example.com");
  aliceToken = await accessTokenFor(alice.userId);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(sql`truncate table device_recordings`);
  await db.update(deviceTokens).set({ revokedAt: null });
});

function request(path: string, init: RequestInit & { token?: string | null } = {}) {
  const { token = aliceToken, ...rest } = init;
  return app.request(
    `/api/v1${path}`,
    {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    TEST_ENV,
  );
}

/** Web アプリ：開始・終了を押す */
async function press(recording: boolean, deviceId = alice.deviceId): Promise<RecordingState> {
  const res = await request(`/devices/${deviceId}/recording`, {
    method: "PUT",
    body: JSON.stringify({ recording }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as RecordingState;
}

/** Web アプリ：状態を見る */
async function state(): Promise<RecordingState> {
  const res = await request(`/devices/${alice.deviceId}/recording`);
  expect(res.status).toBe(200);
  return (await res.json()) as RecordingState;
}

/** ESP32：指示を取りに来る */
async function poll(token = alice.token): Promise<DeviceRecording> {
  const res = await request("/device/recording", { token });
  expect(res.status).toBe(200);
  return (await res.json()) as DeviceRecording;
}

/** ESP32：自分で終えたことを知らせる */
function deviceStop(body: unknown, token = alice.token) {
  return request("/device/recording", { method: "PUT", body: JSON.stringify(body), token });
}

async function expectProblem(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ status, code });
}

const near = (iso: string | null, ms = 10_000) =>
  iso !== null && Math.abs(Date.parse(iso) - Date.now()) < ms;

describe("GET・PUT /devices/{deviceId}/recording（Web アプリ）", () => {
  it("一度も押していなければ停止中・番号 0", async () => {
    expect(await state()).toEqual({
      recording: false,
      seq: 0,
      startedAt: null,
      stoppedAt: null,
      ackedSeq: 0,
      updatedAt: null,
    });
  });

  it("開始で番号が 1 増えて開始時刻が入り、終了でまた 1 増えて終了時刻が入る", async () => {
    const started = await press(true);
    expect(started).toMatchObject({ recording: true, seq: 1, stoppedAt: null, ackedSeq: 0 });
    expect(near(started.startedAt)).toBe(true);

    const stopped = await press(false);
    expect(stopped).toMatchObject({ recording: false, seq: 2, startedAt: started.startedAt });
    expect(near(stopped.stoppedAt)).toBe(true);

    const again = await press(true);
    expect(again).toMatchObject({ recording: true, seq: 3, stoppedAt: stopped.stoppedAt });
    expect(Date.parse(again.startedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(started.startedAt ?? ""),
    );
  });

  it("同じ状態をもう一度送っても番号も時刻も変わらない（二度押し・再送）", async () => {
    const first = await press(true);
    const second = await press(true);
    expect(second).toEqual(first);

    const stopped = await press(false);
    expect(await press(false)).toEqual(stopped);
  });

  it("一度も押していないのに終了を送っても、行を作らず停止中・番号 0 のまま", async () => {
    expect(await press(false)).toMatchObject({ recording: false, seq: 0, stoppedAt: null });
    expect(await db.select().from(deviceRecordings)).toEqual([]);
  });

  it("recording が真偽値でなければ 422", async () => {
    const res = await request(`/devices/${alice.deviceId}/recording`, {
      method: "PUT",
      body: JSON.stringify({ recording: "yes" }),
    });
    await expectProblem(res, 422, "validation_failed");
  });

  it("他人のデバイス・存在しないデバイスは 404 で、指示も出さない", async () => {
    await expectProblem(await request(`/devices/${bob.deviceId}/recording`), 404, "not_found");
    const res = await request(`/devices/${bob.deviceId}/recording`, {
      method: "PUT",
      body: JSON.stringify({ recording: true }),
    });
    await expectProblem(res, 404, "not_found");
    expect((await poll(bob.token)).recording).toBe(false);
    await expectProblem(
      await request(`/devices/${crypto.randomUUID()}/recording`),
      404,
      "not_found",
    );
  });

  it("ログインしていなければ 401、デバイストークンでは呼べない", async () => {
    await expectProblem(
      await request(`/devices/${alice.deviceId}/recording`, { token: null }),
      401,
      "token_missing",
    );
    await expectProblem(
      await request(`/devices/${alice.deviceId}/recording`, { token: alice.token }),
      401,
      "token_invalid",
    );
  });
});

describe("GET /device/recording（ESP32）", () => {
  it("一度も押していなければ停止中・番号 0 とサーバの時刻を返し、行は作らない", async () => {
    const r = await poll();
    expect(r).toMatchObject({ recording: false, seq: 0, startedAt: null, stoppedAt: null });
    expect(near(r.serverTime)).toBe(true);
    expect(await db.select().from(deviceRecordings)).toEqual([]);
  });

  it("開始・終了の指示を返し、取りに来たら画面に「伝わった」と出る（ackedSeq）", async () => {
    const started = await press(true);
    expect((await state()).ackedSeq).toBe(0);

    const r = await poll();
    expect(r).toMatchObject({ recording: true, seq: 1, startedAt: started.startedAt });
    expect((await state()).ackedSeq).toBe(1);

    await press(false);
    expect((await state()).ackedSeq).toBe(1);
    expect(await poll()).toMatchObject({ recording: false, seq: 2 });
    expect((await state()).ackedSeq).toBe(2);
  });

  it("自分のデバイスの指示だけを返す", async () => {
    await press(true);
    expect(await poll(bob.token)).toMatchObject({ recording: false, seq: 0 });
  });

  it("失効したデバイスは 401 device_token_revoked、トークンがなければ 401 device_token_invalid", async () => {
    await db
      .update(deviceTokens)
      .set({ revokedAt: new Date() })
      .where(eq(deviceTokens.deviceId, alice.deviceId));
    await expectProblem(
      await request("/device/recording", { token: alice.token }),
      401,
      "device_token_revoked",
    );
    await expectProblem(
      await request("/device/recording", { token: null }),
      401,
      "device_token_invalid",
    );
  });

  it("キャッシュさせない", async () => {
    const res = await request("/device/recording", { token: alice.token });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("PUT /device/recording（ESP32 が自分で終えた）", () => {
  it("番号が今と同じで記録中なら停止にする（番号は増やさない）", async () => {
    const started = await press(true);
    const res = await deviceStop({ recording: false, seq: started.seq });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeviceRecording;
    expect(body).toMatchObject({ recording: false, seq: started.seq });
    expect(near(body.stoppedAt)).toBe(true);
    expect(await state()).toMatchObject({ recording: false, seq: started.seq });
  });

  it("番号が違えば（その間に別の指示が出ていれば）何も変えない", async () => {
    await press(true);
    await press(false);
    const restarted = await press(true);
    const res = await deviceStop({ recording: false, seq: restarted.seq - 2 });
    expect(res.status).toBe(200);
    expect(await state()).toEqual(restarted);
  });

  it("停止中なら何も変えない", async () => {
    await press(true);
    const stopped = await press(false);
    await deviceStop({ recording: false, seq: stopped.seq });
    expect(await state()).toEqual(stopped);
  });

  it("ESP32 から開始はできない（recording: true は 422）。seq がなければ 422", async () => {
    await expectProblem(await deviceStop({ recording: true, seq: 0 }), 422, "validation_failed");
    await expectProblem(await deviceStop({ recording: false }), 422, "validation_failed");
    expect(await db.select().from(deviceRecordings)).toEqual([]);
  });

  it("他人のデバイスの指示は止められない", async () => {
    const started = await press(true);
    await deviceStop({ recording: false, seq: started.seq }, bob.token);
    expect((await state()).recording).toBe(true);
  });
});

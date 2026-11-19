// テスト用の DB。PGlite（WASM で動く PostgreSQL）にマイグレーションを流して使う
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { exportJWK, generateKeyPair } from "jose";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import type { Bindings } from "../../src/env";
import { type AppOptions, createApp } from "../../src/index";
import type { CreateGoogle, GoogleIdentity } from "../../src/lib/google";
import { loadSigningKeys, signAccessToken } from "../../src/lib/jwt";
import { issueDeviceToken } from "../../src/services/device-tokens";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url).href);

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, client };
}

/** ユーザーとデバイスを 1 つずつ作り、デバイストークンを発行する */
export async function seedDevice(db: Db, email = "lifter@example.com") {
  const [user] = await db.insert(schema.users).values({ email }).returning();
  if (!user) throw new Error("ユーザーを作れませんでした");
  const [device] = await db
    .insert(schema.devices)
    .values({ userId: user.id, name: "部室のベンチ" })
    .returning();
  if (!device) throw new Error("デバイスを作れませんでした");
  const { token, tokenId } = await issueDeviceToken(db, device.id);
  return { userId: user.id, deviceId: device.id, token, tokenId };
}

/** テスト用の ES256 の鍵（実行のたびに作る。本物の鍵はテストに使わない） */
async function generateTestJwk(kid: string): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return JSON.stringify({ ...(await exportJWK(privateKey)), kid });
}

/** テストで Worker に渡すバインディング（app.request の第 3 引数） */
export const TEST_ENV = {
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  JWT_PRIVATE_JWK: await generateTestJwk("test-1"),
} as Partial<Bindings> as Bindings;

/** 別の鍵（署名のすり替えのテスト用） */
export const OTHER_JWK = await generateTestJwk("test-1");

/**
 * 偽の Google。認可コード "code-<名前>" を渡すと、identities[<名前>] の人としてログインできる。
 * それ以外のコードは Google に拒否されたときと同じく例外になる
 */
export function fakeGoogle(identities: Record<string, GoogleIdentity>): CreateGoogle & {
  calls: { code: string; codeVerifier: string; redirectUri: string }[];
} {
  const calls: { code: string; codeVerifier: string; redirectUri: string }[] = [];
  const create: CreateGoogle = (_env, redirectUri) => ({
    authorizationUrl(state, codeVerifier) {
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge_source", codeVerifier);
      url.searchParams.set("redirect_uri", redirectUri);
      return url;
    },
    async exchange(code, codeVerifier) {
      calls.push({ code, codeVerifier, redirectUri });
      const identity = identities[code.replace(/^code-/, "")];
      if (!identity) throw new Error("invalid_grant");
      return identity;
    },
  });
  return Object.assign(create, { calls });
}

/** PGlite の DB を使うアプリ。接続は全テストで共有するので close では何もしない */
export function createTestApp(db: Db, overrides: Partial<AppOptions> = {}) {
  return createApp({ openDb: async () => ({ db, close: async () => {} }), ...overrides });
}

/** テストのリクエストのオリジン（app.request にパスだけ渡したときは http://localhost になる） */
export const TEST_ORIGIN = "http://localhost";

/** ユーザーのアクセストークンを直接作る（ログインの流れを通さずに user 認証の API を試すため） */
export async function accessTokenFor(userId: string, issuer = TEST_ORIGIN): Promise<string> {
  const keys = await loadSigningKeys(TEST_ENV.JWT_PRIVATE_JWK);
  return signAccessToken(keys, { userId, issuer });
}

/** ユーザーだけを作る */
export async function seedUser(db: Db, email = "lifter@example.com"): Promise<string> {
  const [user] = await db.insert(schema.users).values({ email }).returning();
  if (!user) throw new Error("ユーザーを作れませんでした");
  return user.id;
}

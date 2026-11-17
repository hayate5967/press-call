// 開発用：デバイストークンを発行し、DB にハッシュだけを保存する（ペアリングができるまでの代わり）
//
// 使い方（apps/api で実行。DATABASE_URL と ENVIRONMENT は .dev.vars から読む）：
//   pnpm device:issue-token --email you@example.com --name "部室のベンチ"   … ユーザー（なければ作る）とデバイスを作って発行
//   pnpm device:issue-token --device-id <uuid>                               … 既存のデバイスにトークンを追加で発行
//
// 書き込む前に接続先を表示して確認する（--yes で確認を省く）。
// 平文のトークンは最後に一度だけ画面に出す。DB にもファイルにも残らないので、ESP32 か .dev.vars などに控えておく
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs, parseEnv } from "node:util";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { openDb } from "../src/db/client";
import { devices, users } from "../src/db/schema";
import { issueDeviceToken } from "../src/services/device-tokens";

const DEFAULT_DEVICE_NAME = "開発用デバイス";
const DEV_VARS = ".dev.vars";

const USAGE = `使い方:
  pnpm device:issue-token --email <メール> [--name <デバイス名>] [--yes]
  pnpm device:issue-token --device-id <デバイスの UUID> [--yes]`;

function fail(message: string, showUsage = false): never {
  console.error(showUsage ? `エラー: ${message}\n\n${USAGE}` : `エラー: ${message}`);
  process.exit(1);
}

/** エラーの説明。接続文字列（パスワードを含む）は出さない */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}：${err.cause.message}` : err.message;
}

// ---------- 引数 ----------

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    "device-id": { type: "string" },
    yes: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const deviceIdArg = values["device-id"];
if (!values.email === !deviceIdArg) {
  fail("--email か --device-id のどちらか一方を指定してください", true);
}
if (deviceIdArg !== undefined) {
  if (!z.uuid().safeParse(deviceIdArg).success) {
    fail(`--device-id は UUID で指定してください（${deviceIdArg}）`, true);
  }
  if (values.name !== undefined) {
    fail("--name は新しくデバイスを作るとき（--email）だけ使えます", true);
  }
}

// ---------- 接続先と環境 ----------

// DATABASE_URL と ENVIRONMENT は「同じ場所」から取る。
// シェルに別の DATABASE_URL（本番など）が残っていても、.dev.vars の ENVIRONMENT=development で
// 書き込めてしまわないようにするため
const fileVars = existsSync(DEV_VARS) ? parseEnv(readFileSync(DEV_VARS, "utf8")) : {};
const fromShell = process.env.DATABASE_URL !== undefined;
const source = fromShell ? "シェルの環境変数" : DEV_VARS;
const databaseUrl = fromShell ? process.env.DATABASE_URL : fileVars.DATABASE_URL;
const environment = fromShell ? process.env.ENVIRONMENT : fileVars.ENVIRONMENT;

if (!databaseUrl) fail(`DATABASE_URL がありません（${DEV_VARS} に書いてください）`);
// 本番の DB に開発用のトークンを入れないよう、開発環境と明示したときだけ動かす
if (environment !== "development") {
  fail(
    fromShell
      ? "シェルの DATABASE_URL を使うときは、シェルでも ENVIRONMENT=development を指定してください"
      : `${DEV_VARS} に ENVIRONMENT=development がありません`,
  );
}

let host: string;
try {
  host = new URL(databaseUrl).host;
} catch {
  // URL の中身（パスワードを含む）は表示しない
  fail(`DATABASE_URL の形が正しくありません（${source}）`);
}

console.log(`接続先: ${host}（${source}）`);
if (!values.yes) {
  if (!process.stdin.isTTY) fail("確認できないので中止しました。続けるなら --yes を付けてください");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("この DB に書き込みます。よろしいですか？ [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("中止しました");
    process.exit(0);
  }
}

// ---------- 発行 ----------

const conn = await openDb(databaseUrl).catch((err: unknown) => fail(describe(err)));

try {
  const result = await conn.db.transaction(async (tx) => {
    let deviceId: string;
    let userId: string;

    if (deviceIdArg !== undefined) {
      const [device] = await tx
        .select({ userId: devices.userId })
        .from(devices)
        .where(eq(devices.id, deviceIdArg));
      if (!device) throw new Error(`デバイス ${deviceIdArg} が見つかりません`);
      deviceId = deviceIdArg;
      userId = device.userId;
    } else {
      const email = values.email as string;
      const found = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (found.length > 1) {
        throw new Error(`${email} のユーザーが複数います。--device-id で指定してください`);
      }
      const user =
        found[0] ?? (await tx.insert(users).values({ email }).returning({ id: users.id }))[0];
      if (!user) throw new Error("ユーザーを作れませんでした");
      userId = user.id;
      const [device] = await tx
        .insert(devices)
        .values({ userId, name: values.name ?? DEFAULT_DEVICE_NAME })
        .returning({ id: devices.id });
      if (!device) throw new Error("デバイスを作れませんでした");
      deviceId = device.id;
    }

    const { token } = await issueDeviceToken(tx, deviceId);
    return { userId, deviceId, token };
  });

  console.log(`ユーザー:  ${result.userId}`);
  console.log(`デバイス:  ${result.deviceId}`);
  console.log("\nデバイストークン（この 1 回しか表示しません）:");
  console.log(result.token);
} catch (err) {
  console.error(`エラー: ${describe(err)}`);
  process.exitCode = 1;
} finally {
  await conn.close();
}

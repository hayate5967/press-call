// 開発用：デバイストークンを発行し、DB にハッシュだけを保存する（ペアリングができるまでの代わり）
//
// 使い方（apps/api で実行。DATABASE_URL と ENVIRONMENT は .dev.vars から読む）：
//   pnpm device:issue-token --email you@example.com --name "部室のベンチ"   … ユーザー（なければ作る）とデバイス・初期設定を作って発行
//   pnpm device:issue-token --device-id <uuid>                               … 既存のデバイスにトークンを追加で発行
//
// 書き込む前に接続先を表示して確認する（--yes で確認を省く）。
// 平文のトークンは最後に一度だけ画面に出す。DB にもファイルにも残らないので、ESP32 か .dev.vars などに控えておく
import { parseArgs } from "node:util";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { devices, users } from "../src/db/schema";
import { createDefaultDeviceSettings } from "../src/services/device-settings";
import { issueDeviceToken } from "../src/services/device-tokens";
import { describe, fail as failWith, openDevDb } from "./lib/dev-db";

const DEFAULT_DEVICE_NAME = "開発用デバイス";

const USAGE = `使い方:
  pnpm device:issue-token --email <メール> [--name <デバイス名>] [--yes]
  pnpm device:issue-token --device-id <デバイスの UUID> [--yes]`;

function fail(message: string, showUsage = false): never {
  failWith(message, showUsage ? USAGE : undefined);
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

// ---------- 発行 ----------

const conn = await openDevDb({ yes: values.yes });

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
      // ペアリングと同じく、デバイスと一緒に初期設定（自動合図・固定 1.0 秒）の行を作る
      await createDefaultDeviceSettings(tx, deviceId);
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

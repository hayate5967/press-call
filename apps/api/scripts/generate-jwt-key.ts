// アクセストークン（JWT、ES256）の署名用の秘密鍵を作り、JWK（1 行の JSON）で表示する
//
// 使い方（apps/api で実行）：
//   pnpm auth:generate-key            … kid は今の年月（例：2026-11）
//   pnpm auth:generate-key --kid 2027-01
//
// 出てきた 1 行を .dev.vars の JWT_PRIVATE_JWK に貼る。本番は `wrangler secret put JWT_PRIVATE_JWK` で登録する。
// 秘密鍵なので、ファイルに保存したりコミットしたりしない
import { parseArgs } from "node:util";
import { exportJWK, generateKeyPair } from "jose";

const { values } = parseArgs({ options: { kid: { type: "string" } } });
const kid = values.kid ?? new Date().toISOString().slice(0, 7);

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid };
console.log(JSON.stringify(jwk));

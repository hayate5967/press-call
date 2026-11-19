// アクセストークン（JWT、ES256）の署名と検証（ADR-0005、API 仕様書 3 章）
//
// 秘密鍵は JWK（JSON）で環境変数 JWT_PRIVATE_JWK に入れる。公開鍵は秘密鍵から取り出す。
// JWT の中身は誰でも読めるので、入れるのはユーザー ID と期限などの最低限だけにする
import { errors, importJWK, type JWK, type JWTHeaderParameters, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

/** アクセストークンの寿命（15 分） */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** aud（このトークンを受け取ってよい相手）。API 仕様書 3 章 */
export const ACCESS_TOKEN_AUDIENCE = "bench-pause-api";

const ALG = "ES256";

export type SigningKeys = { kid: string; privateKey: CryptoKey; publicKey: CryptoKey };

/** ES256（P-256 の楕円曲線）の秘密鍵の JWK。kid は鍵の名前（例："2026-11"） */
const privateJwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1),
  kid: z.string().min(1),
});

// 鍵の読み込み（importJWK）は重いので、同じ値ならリクエストをまたいで使い回す
const cache = new Map<string, Promise<SigningKeys>>();

/** 環境変数の JWK から署名用と検証用の鍵を作る。値がない・形が違うのは設定の誤りなので例外（500） */
export function loadSigningKeys(privateJwkJson: string | undefined): Promise<SigningKeys> {
  if (!privateJwkJson) {
    throw new Error("JWT_PRIVATE_JWK がありません（pnpm auth:generate-key で作る）");
  }
  let keys = cache.get(privateJwkJson);
  if (!keys) {
    keys = importKeys(privateJwkJson);
    // 失敗した結果は覚えない（設定を直したら次のリクエストで読み直せるように）
    keys.catch(() => cache.delete(privateJwkJson));
    cache.set(privateJwkJson, keys);
  }
  return keys;
}

async function importKeys(json: string): Promise<SigningKeys> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // 値（秘密鍵）はメッセージに入れない
    throw new Error("JWT_PRIVATE_JWK が JSON として読めません");
  }
  const result = privateJwkSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("JWT_PRIVATE_JWK は ES256（EC・P-256）の秘密鍵の JWK で、kid が必要です");
  }
  const { d: _d, ...publicJwk } = result.data;
  const privateKey = (await importJWK(result.data as JWK, ALG)) as CryptoKey;
  const publicKey = (await importJWK(publicJwk as JWK, ALG)) as CryptoKey;
  return { kid: result.data.kid, privateKey, publicKey };
}

/** アクセストークンを発行する。iss は Worker のオリジン */
export function signAccessToken(
  keys: SigningKeys,
  claims: { userId: string; issuer: string },
  now = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, typ: "JWT", kid: keys.kid })
    .setIssuer(claims.issuer)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(keys.privateKey);
}

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "expired" | "invalid" };

/**
 * アクセストークンを検証する。
 * 署名・アルゴリズム・kid・iss・aud・期限をすべて確かめ、期限切れだけは expired として分ける
 * （Web アプリは expired ならリフレッシュし、invalid ならログイン画面へ戻る）
 */
export async function verifyAccessToken(
  keys: SigningKeys,
  token: string,
  issuer: string,
  now = new Date(),
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(
      token,
      (header: JWTHeaderParameters) => {
        // 知らない鍵の名前なら検証しない（鍵を入れ替えたときは、ここで古い kid の公開鍵も選べるようにする）
        if (header.kid !== keys.kid) throw new errors.JWKSNoMatchingKey();
        return keys.publicKey;
      },
      {
        algorithms: [ALG], // "none" や HS256 へのすり替えを受け付けない
        issuer,
        audience: ACCESS_TOKEN_AUDIENCE,
        currentDate: now,
        requiredClaims: ["sub", "iat", "exp"],
      },
    );
    const userId = z.uuid().safeParse(payload.sub);
    if (!userId.success) return { ok: false, reason: "invalid" };
    return { ok: true, userId: userId.data };
  } catch (err) {
    // jose は署名を確かめた後に期限を見るので、JWTExpired なら署名は正しい
    if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

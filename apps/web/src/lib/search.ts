// URL のクエリ・パスの値を確かめる（TanStack Router の validateSearch・beforeLoad から使う）
// URL は誰でも書き換えられるので、知らない値は捨てる

/** ログイン画面に出す案内の理由 */
export type LoginReason = "refresh_token_reused" | "session_expired" | "logged_out";

const LOGIN_REASONS: readonly string[] = ["refresh_token_reused", "session_expired", "logged_out"];

export type LoginSearch = {
  /** Google から戻ったときの失敗（/api/v1/auth/google/callback が付ける） */
  error?: string;
  reason?: LoginReason;
};

export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
  const out: LoginSearch = {};
  if (typeof search.error === "string") out.error = search.error;
  if (typeof search.reason === "string" && LOGIN_REASONS.includes(search.reason)) {
    out.reason = search.reason as LoginReason;
  }
  return out;
}

export type PairSearch = {
  /** bench.local のリンクに入っているコード（入力欄の初期値） */
  code?: string;
};

export function parsePairSearch(search: Record<string, unknown>): PairSearch {
  // ?code=BCDF-GHJK は数字だけなら number に読まれることがあるので、文字列にそろえる
  const code = search.code;
  if (typeof code === "string" || typeof code === "number") return { code: String(code) };
  return {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** デバイスの ID らしい形か（違えば API に問い合わせずに「見つかりません」にする） */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

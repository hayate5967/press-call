// エラーコードを画面に出す文言にする
import type { LoginErrorCode } from "@press-call/shared";
import { ApiProblem, AuthRequiredError } from "./api/client";
import type { LoginReason } from "./lib/search";

const LOGIN_ERRORS: Record<LoginErrorCode, string> = {
  oauth_denied: "Google のログインがキャンセルされました。",
  oauth_state_mismatch:
    "ログインの確認ができませんでした。時間が経ちすぎた可能性があります。もう一度お試しください。",
  oauth_failed: "Google とのやり取りに失敗しました。もう一度お試しください。",
};

/** /login?error=<code> の文言。知らないコードなら null（表示しない） */
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return (LOGIN_ERRORS as Record<string, string>)[code] ?? null;
}

const PROBLEMS: Record<string, string> = {
  user_code_not_found:
    "コードが見つかりません。デバイスの画面（bench.local）のコードを確認してください。",
  user_code_expired:
    "コードの期限（10 分）が切れました。ESP32 を再起動すると新しいコードが出ます。",
  pairing_already_handled: "このコードはすでに許可または拒否されています。",
  precondition_failed: "ほかの画面で設定が変更されていました。最新の設定を読み直しました。",
  not_found: "見つかりません。",
  db_unavailable: "サーバが混み合っています。少し待ってからもう一度お試しください。",
};

const LOGIN_NOTICES: Record<LoginReason, string> = {
  refresh_token_reused: "安全のためログアウトしました。もう一度ログインしてください。",
  session_expired: "ログインの期限が切れました。もう一度ログインしてください。",
  logged_out: "ログアウトしました。",
};

/** ログイン画面に移った理由の文言 */
export function loginNoticeMessage(reason: LoginReason | undefined): string | null {
  return reason ? LOGIN_NOTICES[reason] : null;
}

/** API のエラーなどを画面の文言にする */
export function errorMessage(err: unknown): string {
  if (err instanceof AuthRequiredError) {
    return err.reason === "refresh_token_reused"
      ? "安全のためログアウトしました。もう一度ログインしてください。"
      : "ログインしてください。";
  }
  if (err instanceof ApiProblem) {
    return PROBLEMS[err.code] ?? err.detail ?? err.title;
  }
  if (err instanceof TypeError) return "通信できませんでした。電波の状態を確認してください。";
  return err instanceof Error ? err.message : String(err);
}

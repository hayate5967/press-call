// ログイン画面。ボタンで API の /auth/google/start に移り、Google のログイン画面へ進む
import { ErrorText, Page } from "../components";
import { loginErrorMessage } from "../messages";

export function LoginPage(props: { search: string; notice: string | null }) {
  const error = loginErrorMessage(new URLSearchParams(props.search).get("error"));
  return (
    <Page title="press-call">
      <p>ベンチプレスの記録を見るには、Google アカウントでログインしてください。</p>
      <ErrorText message={error ?? props.notice} />
      {/* fetch ではなくページごと移る（Google の画面へリダイレクトさせるため） */}
      <a className="button primary" href="/api/v1/auth/google/start">
        Google でログイン
      </a>
    </Page>
  );
}

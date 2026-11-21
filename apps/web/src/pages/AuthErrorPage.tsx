// ログインを確かめられなかったとき（503・通信失敗など）の画面。
// リフレッシュトークンはまだ有効かもしれないので、ログアウトさせずにやり直せるようにする
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { ErrorAlert, Page } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { errorMessage } from "../messages";

export function AuthErrorPage(props: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Page title="press-call">
      <ErrorAlert message={errorMessage(props.error)} />
      <Button className="w-full" onClick={() => void router.invalidate()}>
        もう一度試す
      </Button>
    </Page>
  );
}

// ログイン画面。ボタンで API の /auth/google/start に移り、Google のログイン画面へ進む
import { getRouteApi } from "@tanstack/react-router";
import { Dumbbell } from "lucide-react";
import { ErrorAlert } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { loginErrorMessage, loginNoticeMessage } from "../messages";

const route = getRouteApi("/login");

export function LoginPage() {
  const search = route.useSearch();
  const error = loginErrorMessage(search.error ?? null);
  const notice = loginNoticeMessage(search.reason);
  return (
    // 片手で押せるよう、ボタンは画面の下のほうに置く
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-[max(4rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <div className="flex size-24 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/25">
          <Dumbbell className="size-12" strokeWidth={2} aria-hidden />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-[2.125rem] leading-[2.5rem] font-bold tracking-tight">press-call</h1>
          <p className="text-muted-foreground">
            胸の上で止まったら「Press」。
            <br />
            ベンチプレスの記録を自動で残します。
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <ErrorAlert message={error} />
        {!error && notice && <p className="text-center text-sm text-muted-foreground">{notice}</p>}
        {/* fetch ではなくページごと移る（Google の画面へリダイレクトさせるため） */}
        <Button asChild size="lg" className="w-full">
          <a href="/api/v1/auth/google/start">Google でログイン</a>
        </Button>
      </div>
    </main>
  );
}

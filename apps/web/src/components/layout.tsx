// どの画面でも使う枠（見出し・戻るリンク・エラー・読み込み中）
import { Link } from "@tanstack/react-router";
import { ChevronLeft, CircleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/** 戻り先のタブと、戻るリンクに出す名前 */
const BACK_LABELS = { "/": "今日", "/settings": "設定" } as const;

export function Page(props: {
  title: string;
  /** 戻り先（タブの下の画面から、そのタブへ戻る） */
  back?: keyof typeof BACK_LABELS;
  children: ReactNode;
}) {
  return (
    // 左右 16px・上は iPhone のノッチ（セーフエリア）を避ける
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
      <header className="flex flex-col">
        {props.back && (
          // iOS の戻るボタンと同じく「‹ 戻り先の名前」。押せる高さは 44px
          <Link
            to={props.back}
            className="-ml-2 inline-flex h-11 w-fit items-center gap-0.5 rounded-full pr-3 pl-1 text-primary active:opacity-60"
          >
            <ChevronLeft className="size-6" aria-hidden />
            {BACK_LABELS[props.back]}
          </Link>
        )}
        {/* iOS の大きいタイトル（34px・太字） */}
        <h1 className="text-[2.125rem] leading-[2.5rem] font-bold tracking-tight">{props.title}</h1>
      </header>
      {props.children}
    </main>
  );
}

export function ErrorAlert(props: { message: string | null | undefined }) {
  if (!props.message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  );
}

/** 読み込み中の仮の表示 */
export function Loading() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/** 中身がまだないときの表示（iOS の ContentUnavailableView）。なぜ空なのか・どうすればよいかを書く */
export function EmptyState(props: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-10 text-center shadow-card">
      <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/20">
        <Icon className="size-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <div className="text-sm text-muted-foreground">{props.children}</div>
    </div>
  );
}

/** 番号つきの手順。番号はメインの青の丸で出す */
export function Steps(props: { children: ReactNode }) {
  return (
    <ol className="flex flex-col gap-3 [counter-reset:step] [&>li]:relative [&>li]:min-h-7 [&>li]:pl-10 [&>li]:[counter-increment:step] [&>li]:before:absolute [&>li]:before:top-0 [&>li]:before:left-0 [&>li]:before:flex [&>li]:before:size-7 [&>li]:before:items-center [&>li]:before:justify-center [&>li]:before:rounded-full [&>li]:before:bg-primary/10 [&>li]:before:text-sm [&>li]:before:font-semibold [&>li]:before:text-primary [&>li]:before:content-[counter(step)] dark:[&>li]:before:bg-primary/20">
      {props.children}
    </ol>
  );
}

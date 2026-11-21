// ログイン後の画面の枠。スマホで片手でも押しやすいよう、画面の切り替えを下部のタブにまとめる
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { CalendarDays, History, type LucideIcon, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  to: "/" | "/history" | "/settings";
  label: string;
  icon: LucideIcon;
  /** このタブが選ばれている扱いにするパス（設定の下の画面でも「設定」を光らせる） */
  matches: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  { to: "/", label: "今日", icon: CalendarDays, matches: (p) => p === "/" },
  { to: "/history", label: "履歴", icon: History, matches: (p) => p.startsWith("/history") },
  {
    to: "/settings",
    label: "設定",
    icon: Settings,
    matches: (p) => p.startsWith("/settings") || p.startsWith("/devices"),
  },
];

/** 今のパスがどのタブにあたるか（テスト用に外に出す） */
export function activeTab(pathname: string): Tab["to"] | null {
  return TABS.find((t) => t.matches(pathname))?.to ?? null;
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = activeTab(pathname);
  return (
    <>
      {/* タブ（高さ 64px＋下の余白）と iPhone のホームバーの分だけ下を空け、最後の内容がタブに隠れないようにする */}
      <div className="pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </div>
      {/* 内容の上に浮かぶ、すりガラスのタブバー（iOS の Liquid Glass にならう）。
          下の内容が透けて見え、今どこまでスクロールしたかが分かる */}
      <nav
        aria-label="画面の切り替え"
        className="fixed inset-x-4 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 mx-auto max-w-md rounded-full border border-white/60 bg-card/70 p-1.5 shadow-[0_8px_32px_-8px_oklch(0.3_0.08_250/0.25)] backdrop-blur-xl backdrop-saturate-150 reduce-transparency:bg-card dark:border-white/10 dark:bg-card/75"
      >
        <ul className="grid grid-cols-3 gap-1">
          {TABS.map((tab) => {
            const selected = tab.to === active;
            const Icon = tab.icon;
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    // 押せる範囲は高さ 52px（指で押しやすい 44px 以上）。選んでいるタブは青をうすく敷く
                    "flex h-13 flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-semibold transition-colors active:scale-95",
                    selected
                      ? "bg-primary/12 text-primary dark:bg-primary/20"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-6" strokeWidth={selected ? 2.4 : 1.9} aria-hidden />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

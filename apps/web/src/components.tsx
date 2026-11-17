// 画面で共通に使う小さな部品
import type { MouseEvent, ReactNode } from "react";
import { navigate } from "./router";

/** ページを読み直さずに画面を移るリンク */
export function Link(props: { to: string; children: ReactNode; className?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // 新しいタブで開く操作（⌘・Ctrl＋クリックなど）はブラウザに任せる
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(props.to);
  };
  return (
    <a href={props.to} onClick={onClick} className={props.className}>
      {props.children}
    </a>
  );
}

export function ErrorText(props: { message: string | null }) {
  if (!props.message) return null;
  return (
    <p className="error" role="alert">
      {props.message}
    </p>
  );
}

export function Page(props: { title: string; back?: string; children: ReactNode }) {
  return (
    <main className="page">
      {props.back && (
        <p className="back">
          <Link to={props.back}>← 戻る</Link>
        </p>
      )}
      <h1>{props.title}</h1>
      {props.children}
    </main>
  );
}

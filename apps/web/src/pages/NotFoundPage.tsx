import { Page } from "@/components/layout";

export function NotFoundPage() {
  return (
    <Page title="ページが見つかりません" back="/">
      <p className="text-muted-foreground">URL を確認してください。</p>
    </Page>
  );
}

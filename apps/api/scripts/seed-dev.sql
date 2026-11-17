-- 【ステップ3で削除】開発用ブランチに仮のユーザーとデバイスを作る（ペアリングができるまでの一時的なもの）
-- 使い方：psql "$DATABASE_URL" -f scripts/seed-dev.sql
-- 何度流しても同じ結果になる
insert into users (id, email, display_name)
values ('00000000-0000-4000-8000-000000000001', 'dev@example.com', '開発用ユーザー')
on conflict (id) do nothing;

insert into devices (id, user_id, name)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '開発用デバイス')
on conflict (id) do nothing;

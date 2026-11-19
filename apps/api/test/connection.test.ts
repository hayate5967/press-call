// DB の接続先の選び方（本番は Hyperdrive、手元の開発だけ DATABASE_URL）のテスト
import { describe, expect, it } from "vitest";
import { connectionStringFor } from "../src/index";

const hyperdrive = { connectionString: "postgres://hyperdrive" } as Hyperdrive;
const dev = "postgres://neon-dev-branch";

describe("connectionStringFor", () => {
  it("Hyperdrive があればそれを使う（開発でも）", () => {
    expect(
      connectionStringFor({
        HYPERDRIVE: hyperdrive,
        ENVIRONMENT: "development",
        DATABASE_URL: dev,
      }),
    ).toBe("postgres://hyperdrive");
  });

  it("手元の開発で Hyperdrive がなければ DATABASE_URL", () => {
    expect(
      connectionStringFor({
        HYPERDRIVE: undefined as unknown as Hyperdrive,
        ENVIRONMENT: "development",
        DATABASE_URL: dev,
      }),
    ).toBe(dev);
  });

  it("本番では DATABASE_URL があっても使わない（設定の誤りとして例外）", () => {
    expect(() =>
      connectionStringFor({
        HYPERDRIVE: undefined as unknown as Hyperdrive,
        ENVIRONMENT: "production",
        DATABASE_URL: dev,
      }),
    ).toThrow(/接続先がありません/);
  });

  it("開発でも DATABASE_URL がなければ例外", () => {
    expect(() =>
      connectionStringFor({
        HYPERDRIVE: undefined as unknown as Hyperdrive,
        ENVIRONMENT: "development",
      }),
    ).toThrow(/接続先がありません/);
  });
});

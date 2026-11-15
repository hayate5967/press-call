import { describe, expect, it } from "vitest";
import { app } from "../src/index";

describe("GET /api/v1/health", () => {
  it("200 と status: ok を返す", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; time: string };
    expect(body.status).toBe("ok");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});

describe("存在しないパス", () => {
  it("404 を problem+json で返す", async () => {
    const res = await app.request("/api/v1/no-such-path");
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("health が仕様に含まれる", async () => {
    const res = await app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths)).toContain("/health");
  });
});

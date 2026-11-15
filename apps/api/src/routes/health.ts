// GET /api/v1/health：死活確認
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

const HealthResponse = z
  .object({
    status: z.literal("ok"),
    time: z.string().openapi({ example: "2026-11-15T09:30:00.000Z" }),
  })
  .openapi("Health");

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["共通"],
  summary: "死活確認",
  responses: {
    200: {
      description: "API が動いている",
      content: { "application/json": { schema: HealthResponse } },
    },
  },
});

export const health = new OpenAPIHono().openapi(route, (c) =>
  c.json({ status: "ok" as const, time: new Date().toISOString() }, 200),
);

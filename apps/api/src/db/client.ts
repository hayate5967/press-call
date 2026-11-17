// DB への接続。本番は Hyperdrive の接続文字列（env.HYPERDRIVE.connectionString）を渡す
// Hyperdrive 自体が接続プールなので、Worker 側のプールは小さくてよい
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 });
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;

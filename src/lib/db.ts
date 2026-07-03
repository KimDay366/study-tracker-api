import pg from "pg";
import { env } from "./env.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

pool.on("error", (err) => {
  console.error("[db] 예상치 못한 pg 클라이언트 오류:", err);
});

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
) => pool.query<T>(text, values);

export const getClient = () => pool.connect();

export const closePool = () => pool.end();

export default pool;

import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

export const sql =
  globalThis.__sql ??
  postgres(url, {
    max: 10,
    idle_timeout: 30,
    connection: { search_path: "tandem,public" },
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;

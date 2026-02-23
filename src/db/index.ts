import { Pool } from "pg";
import { ENV } from "../config/env";

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables from .env file.
dotenv.config();

const dbUrl = process.env.DATABASE_URL || process.env.SQL_URL;
const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;

const credentials = dbUrl 
  ? { url: dbUrl } 
  : {
      host: sqlHost || 'localhost',
      user: user || 'postgres',
      password: password || '',
      database: sqlDbName || 'postgres',
      ssl: false,
    };

export default defineConfig({
  schema: "./backend/db/schema.ts",
  out: "./drizzle", // Output directory for migrations.
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: credentials,
  verbose: true, // Enable verbose output.
});

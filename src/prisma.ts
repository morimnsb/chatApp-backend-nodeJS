// chat-backend-node/src/prisma.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

/**
 * Prefer absolute SQLite path so running from different working dirs won't break.
 * DATABASE_URL can still override (e.g. file:/abs/path/to/db).
 */
function resolveSqliteUrl(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl && String(envUrl).trim()) return String(envUrl).trim();

  // ESM-safe __dirname replacement
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // In dev: src/
  // In build: dist/
  // projectRoot => .../chat-backend-node
  const projectRoot = path.resolve(__dirname, "..");

  const dbPath = path.join(projectRoot, "prisma", "dev.db");

  // Safest for Windows: file URL (file:///C:/...)
  // Prisma accepts "file:" URLs.
  const fileUrl = pathToFileURL(dbPath).toString(); // file:///.../dev.db

  // Prisma SQLite URL is "file:" not "file:///"
  // but Prisma accepts file URLs too; to be strict we convert:
  // file:///C:/x/y.db -> file:C:/x/y.db
  const strict = fileUrl.replace(/^file:\/\//, "file:");

  return strict;
}

const connectionString = resolveSqliteUrl();

const adapter = new PrismaBetterSqlite3({
  url: connectionString,
});

const prisma = new PrismaClient({
  adapter,
  // log: ["query", "info", "warn", "error"],
});

export default prisma;
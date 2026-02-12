// src/prisma.js
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const connectionString = process.env.DATABASE_URL || "file:./prisma/dev.db";

const adapter = new PrismaBetterSqlite3({
  url: connectionString,
});

const prisma = new PrismaClient({
  adapter,
  // log: ["query", "info", "warn", "error"],
});

export default prisma;

// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // ✅ Prisma 7: url باید اینجا باشد
    url: process.env.DATABASE_URL || "file:./prisma/dev.db",
  },
});

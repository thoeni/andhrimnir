// Prisma configuration
// Only load dotenv in development (Vercel injects env vars directly)
if (process.env.NODE_ENV !== "production") {
  require("dotenv/config");
}
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});

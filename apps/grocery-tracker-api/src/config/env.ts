import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from app .env, then root .env if present
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().default(6060),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DB_PROVIDER: z.enum(["mysql", "supabase", "neondb"]).default("mysql"),
    // Must match apps/habbit-tracker-api/.env so the shared "token" cookie verifies.
    JWT_SECRET: z.string().default("habitpasutri-default-secret-key-12345"),

    // MySQL
    MYSQL_HOST: z.string().default("localhost"),
    MYSQL_USER: z.string().default("root"),
    MYSQL_PASSWORD: z.string().default(""),
    MYSQL_DATABASE: z.string().default("habbit_couple"),
    MYSQL_PORT: z.coerce.number().default(3306),

    // Postgres URL (when DB_PROVIDER is supabase / neondb)
    DATABASE_URL: z.string().optional(),

    // CORS
    ALLOW_ORIGIN_CORS: z.string().optional(),

    // Shared session cookie across subdomains (e.g. .pasutri.com). Leave empty on localhost.
    COOKIE_DOMAIN: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.DB_PROVIDER === "mysql") {
      if (!data.MYSQL_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MYSQL_HOST"],
          message: "MYSQL_HOST is required when DB_PROVIDER is mysql",
        });
      }
      if (!data.MYSQL_USER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MYSQL_USER"],
          message: "MYSQL_USER is required when DB_PROVIDER is mysql",
        });
      }
      if (!data.MYSQL_DATABASE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["MYSQL_DATABASE"],
          message: "MYSQL_DATABASE is required when DB_PROVIDER is mysql",
        });
      }
    } else if (data.DB_PROVIDER === "supabase" || data.DB_PROVIDER === "neondb") {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message: "DATABASE_URL is required when DB_PROVIDER is supabase or neondb",
        });
      }
    }
  });

export const env = envSchema.parse(process.env);

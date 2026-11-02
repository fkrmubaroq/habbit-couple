import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
    PORT: z.coerce.number().default(7070),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PROVIDER: z.enum(["mysql", "supabase", "neondb"]),
  JWT_SECRET: z.string().default("habitpasutri-default-secret-key-12345"),

  // MySQL
  MYSQL_HOST: z.string().optional(),
  MYSQL_USER: z.string().optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_DATABASE: z.string().optional(),
  MYSQL_PORT: z.coerce.number().default(3306),

  // Postgres URL (when DB_PROVIDER is supabase)
  DATABASE_URL: z.string().optional(),

  // CORS
  ALLOW_ORIGIN_CORS: z.string().optional(),

  // Shared session cookie across subdomains (e.g. .pasutri.com). Leave empty on localhost.
  COOKIE_DOMAIN: z.string().optional(),

  // Origins allowed as `returnTo` targets after login (comma-separated, exact origin match)
  ALLOWED_REDIRECT_ORIGINS: z.string().optional(),
}).superRefine((data, ctx) => {
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

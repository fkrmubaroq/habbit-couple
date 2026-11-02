#!/usr/bin/env node
import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const apps = [
  "habbit-tracker-api",
  "habbit-tracker-web",
  "finance-tracker-api",
  "finance-tracker-web",
  "grocery-tracker-api",
  "grocery-tracker-web",
  "pomodoro-tracker-api",
  "pomodoro-tracker-web",
];

const force = process.argv.includes("--force");

let ok = 0;
let skipped = 0;
let missing = 0;

for (const app of apps) {
  const src = join(root, "apps", app, ".env.deploy");
  const dest = join(root, "apps", app, ".env");

  try {
    await access(src, constants.F_OK);
  } catch {
    console.error(`MISS  ${app}: .env.deploy tidak ditemukan`);
    missing++;
    continue;
  }

  try {
    await access(dest, constants.F_OK);
    if (!force) {
      console.log(`SKIP  ${app}: .env sudah ada (pakai --force untuk menimpa)`);
      skipped++;
      continue;
    }
  } catch {
    // dest belum ada, aman untuk ditulis
  }

  await copyFile(src, dest);
  console.log(`OK    ${app}: .env.deploy -> .env`);
  ok++;
}

console.log(`\nSelesai: ${ok} disalin, ${skipped} dilewati, ${missing} tidak ditemukan.`);

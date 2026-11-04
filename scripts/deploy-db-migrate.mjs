#!/usr/bin/env node
// Migrate database produksi via SSH tunnel (OpenSSH).
//
// Semua API memakai SATU database: habbit_couple (MySQL di VPS, 127.0.0.1:3306).
// Kredensial dibaca dari apps/habbit-tracker-api/.env.deploy.
//
// Alur:
//   1. buka tunnel: ssh -N -L <localPort>:<dbHost>:<dbPort> user@host
//   2. tunggu port lokal siap
//   3. jalankan pnpm --filter @repo/<app> run db:migrate per app
//      dengan env: DB_PROVIDER=mysql, MYSQL_HOST=127.0.0.1, MYSQL_PORT=<localPort>
//      (env proses menimpa .env lokal karena dotenv tidak menimpa variabel yang sudah ada)
//   4. tutup tunnel
//
// Pemakaian:
//   node scripts/deploy-db-migrate.mjs [opsi]
//
// Opsi:
//   --host <ip>        default 43.134.25.137
//   --user <nama>      default ubuntu
//   --port <port>      default 22
//   --key <file>       file private key ssh (opsional)
//   --local-port <p>   default 33070
//   --app a,b          subset app (default: habbit,finance,grocery,pomodoro)
//   --task migrate|seed|migrate,seed   default migrate
//                      seed habit DESTRUKTIF: menghapus users/habits/logs lalu mengisi data demo
//   --yes, -y          lewati konfirmasi
//   --help, -h         tampilkan bantuan

import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONFIG = {
  user: "ubuntu",
  host: "43.134.25.137",
  port: "22",
  key: null,
  localPort: "33070",
};

// habbit dulu: pemilik tabel users yang dipakai app lain.
const APPS_ORDER = [
  "habbit-tracker-api",
  "finance-tracker-api",
  "grocery-tracker-api",
  "pomodoro-tracker-api",
];

const ENV_APP = "habbit-tracker-api";

const TASKS = ["migrate", "seed"];

function parseArgs(argv) {
  const opts = { ...CONFIG, apps: [...APPS_ORDER], tasks: ["migrate"], yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host" || a === "-H") opts.host = argv[++i];
    else if (a === "--user" || a === "-u") opts.user = argv[++i];
    else if (a === "--port" || a === "-p") opts.port = argv[++i];
    else if (a === "--key" || a === "-i") opts.key = argv[++i];
    else if (a === "--local-port") opts.localPort = argv[++i];
    else if (a === "--task" || a === "--tasks") {
      const picked = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = picked.filter((t) => !TASKS.includes(t));
      if (unknown.length) {
        console.error(`ERROR: task tidak dikenal: ${unknown.join(", ")} (pilihan: ${TASKS.join(", ")})`);
        process.exit(1);
      }
      opts.tasks = TASKS.filter((t) => picked.includes(t));
    } else if (a === "--app" || a === "--apps") {
      const picked = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = picked.filter((p) => !APPS_ORDER.includes(p));
      if (unknown.length) {
        console.error(`ERROR: app tidak dikenal: ${unknown.join(", ")}`);
        process.exit(1);
      }
      opts.apps = APPS_ORDER.filter((a) => picked.includes(a));
    } else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

function sq(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function target(cfg) {
  return `${cfg.user}@${cfg.host}`;
}

function sshOpts(cfg) {
  const o = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", "-p", cfg.port];
  if (cfg.key) o.push("-i", cfg.key);
  return o;
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function tryConnect(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: Number(port) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function waitForTunnel(port, tunnelProc, maxMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    if (tunnelProc.exitCode !== null) {
      throw new Error(`tunnel ssh keluar lebih awal (exit ${tunnelProc.exitCode})`);
    }
    if (await tryConnect(port, 1000)) return;
  }
  throw new Error(`port lokal ${port} tidak kunjung siap`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(
      [
        "Migrate / seed DB produksi (habbit_couple) via SSH tunnel.",
        "Opsi: --host --user --port --key --local-port --app --task --yes --help",
        "Task: migrate (default), seed, migrate,seed",
        "PERINGATAN: seed habit menghapus users/habits/logs/streaks lalu mengisi data demo.",
      ].join("\n"),
    );
    return;
  }

  const envPath = join(root, "apps", ENV_APP, ".env.deploy");
  let dbEnv;
  try {
    dbEnv = parseEnvFile(await readFile(envPath, "utf8"));
  } catch {
    console.error(`ERROR: tidak bisa membaca ${envPath}`);
    process.exit(1);
  }

  const remoteDbHost = dbEnv.MYSQL_HOST || "127.0.0.1";
  const remoteDbPort = dbEnv.MYSQL_PORT || "3306";
  const database = dbEnv.MYSQL_DATABASE;
  if (!database || !dbEnv.MYSQL_USER || !dbEnv.MYSQL_PASSWORD) {
    console.error("ERROR: MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE tidak lengkap di .env.deploy");
    process.exit(1);
  }

  console.log(`Target  : ${target(opts)} -> ${remoteDbHost}:${remoteDbPort}/${database}`);
  console.log(`Tunnel  : 127.0.0.1:${opts.localPort}`);
  console.log(`Apps    : ${opts.apps.join(", ")}`);
  console.log(`Tasks   : ${opts.tasks.join(" -> ")}`);
  if (opts.tasks.includes("seed")) {
    console.log("PERINGATAN: seed habit MENGHAPUS users/habits/logs/streaks lalu mengisi data demo Romeo & Juliet.");
  }
  console.log();

  if (!opts.yes) {
    const go = await ask("Lanjut jalankan ke DB produksi? [y/N]: ");
    if (!["y", "yes"].includes(go.toLowerCase())) {
      console.log("Dibatalkan.");
      return;
    }
  }

  const tunnel = spawn(
    "ssh",
    [...sshOpts(opts), "-N", "-L", `${opts.localPort}:${remoteDbHost}:${remoteDbPort}`, target(opts)],
    { stdio: "ignore" },
  );

  try {
    process.stdout.write("  membuka tunnel ... ");
    await waitForTunnel(opts.localPort, tunnel);
    console.log("OK");

    let ok = 0;
    const failures = [];
    const total = opts.tasks.length * opts.apps.length;
    for (const task of opts.tasks) {
      const script = task === "seed" ? "db:seed" : "db:migrate";
      if (task === "seed") {
        console.log("\n>>> TASK seed: seed habit bersifat destruktif (data users/habits/logs diganti data demo)");
      }
      for (const app of opts.apps) {
        console.log(`\n=== ${task} ${app} ===`);
        const r = spawnSync(
          "pnpm",
          ["--filter", `@repo/${app}`, "run", script],
          {
            shell: true,
            stdio: "inherit",
            env: {
              ...process.env,
              DB_PROVIDER: "mysql",
              MYSQL_HOST: "127.0.0.1",
              MYSQL_PORT: String(opts.localPort),
              MYSQL_USER: dbEnv.MYSQL_USER,
              MYSQL_PASSWORD: dbEnv.MYSQL_PASSWORD,
              MYSQL_DATABASE: database,
            },
          },
        );
        if (r.status === 0) ok++;
        else failures.push(`${task}:${app}`);
      }
    }

    console.log(`\nSelesai: ${ok}/${total} berhasil.`);
    if (failures.length) {
      console.error(`Gagal: ${failures.join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    tunnel.kill();
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

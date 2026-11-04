#!/usr/bin/env node
// Upload .env.deploy -> .env di VPS via scp (OpenSSH).
// Path mengikuti layout baru deploy-app.mjs: <remoteBase>/<app>/.env
// Restart pm2 dilakukan tahap refresh (pnpm deploy:refresh), bukan di sini.

import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS = {
  user: "ubuntu",
  host: "43.134.25.137",
  port: "22",
  path: "/var/www/habbit-couple",
};

const APPS = [
  "habbit-tracker-api",
  "habbit-tracker-web",
  "finance-tracker-api",
  "finance-tracker-web",
  "grocery-tracker-api",
  "grocery-tracker-web",
  "pomodoro-tracker-api",
  "pomodoro-tracker-web",
];

const PM2_INSTANCES = {
  "habbit-tracker-api": "habbit-tracker-api",
  "finance-tracker-api": "finance-tracker-api",
  "grocery-tracker-api": "grocery-tracker-api",
  "pomodoro-tracker-api": "pomodoro-tracker-api",
};

function parseArgs(argv) {
  const opts = { host: null, user: null, port: null, path: null, restart: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user" || a === "-u") opts.user = argv[++i];
    else if (a === "--host" || a === "-H") opts.host = argv[++i];
    else if (a === "--port" || a === "-p") opts.port = argv[++i];
    else if (a === "--path" || a === "--remote-path") opts.path = argv[++i];
    else if (a === "--restart") opts.restart = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (!opts.target && a.includes("@")) opts.target = a;
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

function run(cmd, args, { quiet = false } = {}) {
  return spawnSync(cmd, args, {
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
}

function hasTool(cmd) {
  const r = spawnSync(cmd, ["-V"], { stdio: "ignore" });
  return !r.error;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!hasTool("ssh") || !hasTool("scp")) {
    console.error("ERROR: ssh/scp (OpenSSH) tidak ditemukan di PATH.");
    process.exit(1);
  }

  let target = opts.target;
  if (!target && opts.user && opts.host) target = `${opts.user}@${opts.host}`;
  if (!target) {
    console.log("=== Deploy .env.deploy -> .env via SSH (OpenSSH) ===\n");
    const user = (await ask(`Username SSH [${DEFAULTS.user}]: `)) || DEFAULTS.user;
    const host = (await ask(`IP / host [${DEFAULTS.host}]: `)) || DEFAULTS.host;
    opts.port = (await ask(`Port [${DEFAULTS.port}]: `)) || DEFAULTS.port;
    target = `${user}@${host}`;
  }
  opts.port = opts.port || DEFAULTS.port;

  let remoteBase = opts.path;
  if (!remoteBase) {
    remoteBase =
      (await ask(`Path deploy di server [${DEFAULTS.path}]: `)) || DEFAULTS.path;
  }

  let restart = opts.restart;
  if (!opts.yes && !opts.restart) {
    const a = await ask("Restart pm2 setelah upload? [y/N]: ");
    restart = ["y", "yes"].includes(a.toLowerCase());
  }

  if (!target || !remoteBase) {
    console.error("ERROR: target dan path deploy wajib diisi.");
    process.exit(1);
  }

  const sshOpts = ["-p", opts.port];
  const scpOpts = ["-P", opts.port];

  const appsDir = join(root, "apps");
  const onDisk = await readdir(appsDir);

  const available = [];
  for (const app of APPS) {
    if (!onDisk.includes(app)) continue;
    try {
      await access(join(root, "apps", app, ".env.deploy"), constants.F_OK);
      available.push(app);
    } catch {
      console.warn(`MISS  ${app}: .env.deploy tidak ada, dilewati`);
    }
  }

  if (available.length === 0) {
    console.error("ERROR: tidak ada .env.deploy yang bisa di-deploy.");
    process.exit(1);
  }

  console.log(`\nTarget: ${target} (port ${opts.port})`);
  console.log(`Remote: ${remoteBase}/<app>/.env\n`);

  let ok = 0;
  for (const app of available) {
    const src = join(root, "apps", app, ".env.deploy");
    const dest = `${target}:${remoteBase}/${app}/.env`;
    process.stdout.write(`-> ${app} ... `);
    const r = run("scp", [...scpOpts, src, dest]);
    if (r.status === 0) {
      console.log("OK");
      ok++;
    } else {
      console.log("GAGAL");
    }
  }

  console.log(`\nUpload selesai: ${ok}/${available.length} berhasil.`);

  if (restart) {
    console.log("\nKelola pm2 ...");
    const q = remoteBase.replace(/'/g, "'\\''");

    const apiApps = available.filter((a) => PM2_INSTANCES[a]);
    const lines = [`cd '${q}' || exit 1`];

    for (const app of apiApps) {
      const name = PM2_INSTANCES[app];
      const cwd = `${remoteBase}/${app}/dist`;
      const cwdQ = cwd.replace(/'/g, "'\\''");
      lines.push(`echo "-> ${name}"`);
      lines.push(
        `if pm2 describe '${name}' > /dev/null 2>&1; then ` +
          `pm2 restart '${name}' --update-env; ` +
          `else (cd '${cwdQ}' && pm2 start index.mjs --name '${name}') || exit 1; fi`,
      );
    }

    if (apiApps.length === 0) {
      console.log("(tidak ada API instance untuk di-restart)");
    } else {
      const cmd = lines.join(" && ");
      const r = run("ssh", [...sshOpts, target, cmd]);
      if (r.status !== 0) {
        console.error("PERINGATAN: pengelolaan pm2 gagal — cek manual di server.");
      } else {
        run("ssh", [...sshOpts, target, "pm2 save"]);
      }
    }
  } else {
    console.log("pm2 tidak di-restart (jalankan pnpm deploy:refresh).");
  }

  console.log("\nSelesai.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

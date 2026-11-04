#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, copyFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { build as esbuildBundle } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = join(root, "apps");

const CONFIG = {
  user: "ubuntu",
  host: "43.134.25.137",
  port: "22",
  base: "/var/www/habbit-couple",
  key: null,
};

const APPS = {
  "habbit-tracker-api": { kind: "api", pm2: "habbit-tracker-api", port: 7070 },
  "finance-tracker-api": { kind: "api", pm2: "finance-tracker-api", port: 5050 },
  "grocery-tracker-api": { kind: "api", pm2: "grocery-tracker-api", port: 6060 },
  "pomodoro-tracker-api": { kind: "api", pm2: "pomodoro-tracker-api", port: 9090 },
  "habbit-tracker-web": { kind: "web", domain: "habbit-tracker.saenahow.com" },
  "finance-tracker-web": { kind: "web", domain: "habbit-finance.saenahow.com" },
  "grocery-tracker-web": { kind: "web", domain: "habbit-grocery.saenahow.com" },
  "pomodoro-tracker-web": { kind: "web", domain: "habbit-pomodoro.saenahow.com" },
};

const BUNDLE_EXTERNALS = ["pg-native", "bufferutil", "utf-8-validate"];
const REQUIRE_BANNER =
  "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);";

const HELP = `
Deploy per-app ke VPS memakai ssh/scp (key auth).

Pemakaian:
  node scripts/deploy-app.mjs [app ...] [opsi]

Pemilihan app:
  (tanpa argumen)          menu interaktif
  habbit-tracker-api ...   satu/lebih nama app sebagai argumen
  --app a,b                daftar app dipisah koma
  --all                    semua app

Opsi:
  --host <ip>              default ${CONFIG.host}
  --user <nama>            default ${CONFIG.user}
  --port <port>            default ${CONFIG.port}
  --base <path>            default ${CONFIG.base}
  --key <file>             file private key ssh (opsional)
  --skip-build             lewati build, pakai artefak yang sudah ada
  --refresh                tanpa build/upload: restart pm2 (api) / reload nginx (web)
  --dry-run                tampilkan perintah tanpa menjalankannya
  --yes, -y                lewati konfirmasi
  --help, -h               tampilkan bantuan

App yang tersedia:
${Object.entries(APPS)
  .map(([name, meta]) => `  - ${name} (${meta.kind})`)
  .join("\n")}

Catatan:
  - Konfigurasi nginx dikelola terpisah: node scripts/deploy-nginx.mjs (pnpm deploy:nginx)
  - Restart pm2 & reload nginx ada di mode --refresh (pnpm deploy:refresh)
`.trim();

function parseArgs(argv) {
  const opts = { apps: [], ...CONFIG, skipBuild: false, refresh: false, dryRun: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app" || a === "--apps") opts.apps.push(...argv[++i].split(","));
    else if (a === "--all") opts.apps.push(...Object.keys(APPS));
    else if (a === "--host" || a === "-H") opts.host = argv[++i];
    else if (a === "--user" || a === "-u") opts.user = argv[++i];
    else if (a === "--port" || a === "-p") opts.port = argv[++i];
    else if (a === "--base" || a === "--path") opts.base = argv[++i];
    else if (a === "--key" || a === "-i") opts.key = argv[++i];
    else if (a === "--skip-build") opts.skipBuild = true;
    else if (a === "--refresh") opts.refresh = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (!a.startsWith("-")) opts.apps.push(a);
  }
  opts.apps = [...new Set(opts.apps.map((s) => s.trim()).filter(Boolean))];
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

function hasTool(cmd) {
  const r = spawnSync(cmd, ["-V"], { stdio: "ignore" });
  return !r.error;
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

function scpOpts(cfg) {
  const o = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15", "-P", cfg.port];
  if (cfg.key) o.push("-i", cfg.key);
  return o;
}

function run(cmd, args, cfg) {
  if (cfg.dryRun) {
    const shown = args.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ");
    console.log(`    $ ${cmd} ${shown}`);
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} gagal (exit ${r.status})`);
  return r;
}

function remote(cfg, script) {
  return run("ssh", [...sshOpts(cfg), target(cfg), `bash -lc ${sq(script)}`], cfg);
}

function remoteTty(cfg, script) {
  return run("ssh", ["-t", ...sshOpts(cfg), target(cfg), `bash -lc ${sq(script)}`], cfg);
}

function runStep(label, fn) {
  process.stdout.write(`  ${label} ... `);
  const result = fn();
  console.log("OK");
  return result;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function build(app, dryRun) {
  const cmd = `pnpm turbo run build --filter=@repo/${app}`;
  if (dryRun) {
    console.log(`    $ ${cmd}`);
    return;
  }
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`build gagal: ${app}`);
}

async function bundleApi(app, dryRun) {
  const entry = join(appsDir, app, "dist", "index.js");
  const outDir = join(appsDir, app, "dist-bundle");
  const outfile = join(outDir, "index.mjs");
  if (dryRun) {
    console.log(`    $ esbuild ${entry} -> ${outfile}`);
    return;
  }
  await rm(outDir, { recursive: true, force: true });
  await esbuildBundle({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: BUNDLE_EXTERNALS,
    banner: { js: REQUIRE_BANNER },
    logLevel: "info",
  });
}

async function prepareWebEnv(app) {
  const source = join(appsDir, app, ".env.deploy");
  if (!(await exists(source))) return;
  await copyFile(source, join(appsDir, app, ".env.production"));
}

function pm2RestartScript(app, cfg) {
  const remoteDir = `${cfg.base}/${app}`;
  const pm2 = APPS[app].pm2;
  return (
    `export PATH="$HOME/.local/share/pnpm/bin:/usr/local/bin:/usr/bin:$PATH"; ` +
    `command -v pm2 >/dev/null 2>&1 || { echo "pm2 tidak ditemukan untuk user $(whoami), PATH=$PATH" >&2; exit 127; }; ` +
    `cd ${sq(remoteDir)} && ( pm2 describe ${sq(pm2)} >/dev/null 2>&1 ` +
    `&& pm2 restart ${sq(pm2)} --update-env ` +
    `|| pm2 start ${sq(`${remoteDir}/dist/index.mjs`)} --name ${sq(pm2)} ) ` +
    `&& pm2 save`
  );
}

function healthCheckScript(app) {
  return (
    `for i in 1 2 3 4 5 6; do ` +
    `curl -fsS --max-time 3 http://127.0.0.1:${APPS[app].port}/health && exit 0; ` +
    `sleep 1; done; ` +
    `echo "health check gagal untuk ${app} setelah 6 percobaan" >&2; exit 1`
  );
}

function nginxReloadScript() {
  return (
    `command -v nginx >/dev/null 2>&1 || { echo "nginx tidak terpasang di server" >&2; exit 127; }; ` +
    `sudo sh -c 'nginx -t && systemctl reload nginx'`
  );
}

async function deployApi(app, cfg) {
  const remoteDir = `${cfg.base}/${app}`;

  if (cfg.skipBuild) {
    console.log("  build+bundle ... DILEWATI (--skip-build)");
  } else {
    runStep("build", () => build(app, cfg.dryRun));
    await runStep("bundle", () => bundleApi(app, cfg.dryRun));
  }

  runStep("siapkan folder", () =>
    remote(cfg, `rm -rf ${sq(`${remoteDir}/dist`)} && mkdir -p ${sq(`${remoteDir}/dist`)}`),
  );

  runStep("upload bundle", () =>
    run(
      "scp",
      [...scpOpts(cfg), join(appsDir, app, "dist-bundle", "index.mjs"), `${target(cfg)}:${remoteDir}/dist/index.mjs`],
      cfg,
    ),
  );

  if (await exists(join(appsDir, app, ".env.deploy"))) {
    runStep("upload .env", () =>
      run("scp", [...scpOpts(cfg), join(appsDir, app, ".env.deploy"), `${target(cfg)}:${remoteDir}/.env`], cfg),
    );
  } else {
    console.log("  upload .env ... DILEWATI (.env.deploy tidak ada)");
  }
}

async function deployWeb(app, cfg) {
  const remoteDir = `${cfg.base}/${app}`;
  const localDist = join(appsDir, app, "dist");

  if (cfg.skipBuild) {
    console.log("  build ... DILEWATI (--skip-build)");
  } else {
    await prepareWebEnv(app);
    runStep("build", () => build(app, cfg.dryRun));
  }

  runStep("bersihkan folder", () => remote(cfg, `rm -rf ${sq(remoteDir)} && mkdir -p ${sq(remoteDir)}`));

  runStep("upload dist", () =>
    run("scp", [...scpOpts(cfg), "-r", `${localDist.replace(/\\/g, "/")}/.`, `${target(cfg)}:${remoteDir}/`], cfg),
  );

  runStep("perbaiki permission", () => remote(cfg, `chmod -R a+rX ${sq(remoteDir)}`));
}

function refreshApp(app, cfg) {
  if (APPS[app].kind === "api") {
    runStep("restart pm2", () => remote(cfg, pm2RestartScript(app, cfg)));
    runStep("cek health", () => remote(cfg, healthCheckScript(app)));
  } else {
    runStep("reload nginx (sudo)", () => remoteTty(cfg, nginxReloadScript()));
  }
}

async function askApps() {
  const names = Object.keys(APPS);
  console.log("App yang tersedia:\n");
  names.forEach((name, i) => console.log(`  ${String(i + 1).padStart(2)}. ${name} (${APPS[name].kind})`));
  const ans = await ask("\nPilih nomor (pisah koma), 'all', atau nama app: ");
  if (ans.toLowerCase() === "all") return names;
  const picked = ans
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const idx = Number(token);
      if (Number.isInteger(idx) && idx >= 1 && idx <= names.length) return names[idx - 1];
      return token;
    });
  const valid = picked.filter((a) => APPS[a]);
  const unknown = picked.filter((a) => !APPS[a]);
  if (unknown.length) console.log(`Dilewati (nama app tidak dikenal): ${unknown.join(", ")}`);
  return valid;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!hasTool("ssh") || !hasTool("scp")) {
    console.error("ERROR: ssh/scp (OpenSSH) tidak ditemukan di PATH.");
    process.exit(1);
  }

  if (opts.apps.length === 0) {
    opts.apps = await askApps();
  }

  if (opts.apps.length === 0) {
    console.error("ERROR: tidak ada app yang dipilih.");
    process.exit(1);
  }

  console.log(`\nTarget : ${target(opts)}:${opts.base}`);
  console.log(`App    : ${opts.apps.join(", ")}`);
  const modeBits = [
    opts.refresh ? "REFRESH" : "deploy",
    opts.dryRun ? "DRY-RUN" : "jalan",
    opts.skipBuild && !opts.refresh ? "tanpa build" : null,
  ].filter(Boolean);
  console.log(`Mode   : ${modeBits.join(", ")}\n`);

  if (!opts.yes && !opts.dryRun) {
    const go = await ask(opts.refresh ? "Lanjut refresh? [y/N]: " : "Lanjut deploy? [y/N]: ");
    if (!["y", "yes"].includes(go.toLowerCase())) {
      console.log("Dibatalkan.");
      return;
    }
  }

  const failures = [];
  for (const app of opts.apps) {
    console.log(`\n=== ${app} (${APPS[app].kind}) ===`);
    try {
      if (opts.refresh) await refreshApp(app, opts);
      else if (APPS[app].kind === "api") await deployApi(app, opts);
      else await deployWeb(app, opts);
    } catch (e) {
      console.error(`  GAGAL: ${e.message}`);
      failures.push(app);
    }
  }

  console.log(`\nSelesai: ${opts.apps.length - failures.length}/${opts.apps.length} berhasil.`);
  if (failures.length) {
    console.error(`Gagal: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

#!/usr/bin/env node
// Deploy konfigurasi nginx gabungan (scripts/nginx/habbit-couple.conf) ke VPS
// memakai ssh/scp (OpenSSH), menggantikan conf per-app warisan deploy-app.mjs.
//
// Pemakaian:
//   node scripts/deploy-nginx.mjs [opsi]
//
// Opsi:
//   --host <ip>        default 43.134.25.137
//   --user <nama>      default ubuntu
//   --port <port>      default 22
//   --key <file>       file private key ssh (opsional)
//   --conf <file>      default scripts/nginx/habbit-couple.conf
//   --skip-verify      lewati uji curl 8 domain setelah reload
//   --dry-run          tampilkan perintah tanpa menjalankannya
//   --yes, -y          lewati konfirmasi
//   --help, -h         tampilkan bantuan

import { spawnSync } from "node:child_process";
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
  conf: join(root, "scripts", "nginx", "habbit-couple.conf"),
  remoteName: "habbit-couple.conf",
};

const WEB_DOMAINS = [
  "habbit-tracker.saenahow.com",
  "habbit-finance.saenahow.com",
  "habbit-grocery.saenahow.com",
  "habbit-pomodoro.saenahow.com",
];

const API_TARGETS = [
  { domain: "api-habbit-tracker.saenahow.com", port: 7070 },
  { domain: "api-habbit-finance.saenahow.com", port: 5050 },
  { domain: "api-habbit-grocery.saenahow.com", port: 6060 },
  { domain: "api-habbit-pomodoro.saenahow.com", port: 8080 },
];

// Conf per-app warisan deploy-app.mjs yang sudah tercakup file gabungan.
const LEGACY_CONFS = [
  "habbit-tracker-web",
  "finance-tracker-web",
  "grocery-tracker-web",
  "pomodoro-tracker-web",
];

function parseArgs(argv) {
  const opts = { ...CONFIG, skipVerify: false, dryRun: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host" || a === "-H") opts.host = argv[++i];
    else if (a === "--user" || a === "-u") opts.user = argv[++i];
    else if (a === "--port" || a === "-p") opts.port = argv[++i];
    else if (a === "--key" || a === "-i") opts.key = argv[++i];
    else if (a === "--conf") opts.conf = argv[++i];
    else if (a === "--skip-verify") opts.skipVerify = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--yes" || a === "-y") opts.yes = true;
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

function installScript(cfg) {
  const available = `/etc/nginx/sites-available/${cfg.remoteName}`;
  const enabled = `/etc/nginx/sites-enabled/${cfg.remoteName}`;
  const legacyPaths = LEGACY_CONFS.flatMap((n) => [`/etc/nginx/sites-enabled/${n}.conf`, `/etc/nginx/sites-available/${n}.conf`]);
  return (
    "set -e; " +
    `mv /tmp/${cfg.remoteName} ${available} && ` +
    `chmod 644 ${available} && ` +
    `rm -f ${legacyPaths.join(" ")} && ` +
    `ln -sf ${available} ${enabled} && ` +
    "nginx -t && systemctl reload nginx"
  );
}

function verifyScript() {
  const webUrls = WEB_DOMAINS.map((d) => `http://${d}/`).join(" ");
  const apiUrls = API_TARGETS.map((a) => `http://${a.domain}/health`).join(" ");
  return (
    "fail=0; " +
    `for u in ${webUrls}; do ` +
    `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u" || echo ERR); ` +
    `if [ "$code" = "200" ]; then echo "OK   $u -> $code"; else echo "GAGAL $u -> $code"; fail=1; fi; done; ` +
    `for u in ${apiUrls}; do ` +
    `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u" || echo ERR); ` +
    `if [ "$code" = "200" ]; then echo "OK   $u -> $code"; else echo "GAGAL $u -> $code"; fail=1; fi; done; ` +
    "exit $fail"
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(
      [
        "Deploy nginx gabungan ke VPS memakai ssh/scp (key auth).",
        "",
        "Opsi: --host --user --port --key --conf --skip-verify --dry-run --yes --help",
      ].join("\n"),
    );
    return;
  }

  if (!hasTool("ssh") || !hasTool("scp")) {
    console.error("ERROR: ssh/scp (OpenSSH) tidak ditemukan di PATH.");
    process.exit(1);
  }

  let confBody;
  try {
    confBody = await readFile(opts.conf, "utf8");
  } catch {
    console.error(`ERROR: file conf tidak bisa dibaca: ${opts.conf}`);
    process.exit(1);
  }
  const serverBlocks = (confBody.match(/^server \{/gm) || []).length;

  console.log(`Target : ${target(opts)} -> /etc/nginx/sites-available/${opts.remoteName}`);
  console.log(`Conf   : ${opts.conf} (${serverBlocks} server block)`);
  console.log(`Mode   : ${opts.dryRun ? "DRY-RUN" : "jalan"}\n`);

  if (!opts.yes && !opts.dryRun) {
    const go = await ask("Lanjut deploy nginx? [y/N]: ");
    if (!["y", "yes"].includes(go.toLowerCase())) {
      console.log("Dibatalkan.");
      return;
    }
  }

  runStep("upload conf ke /tmp", () =>
    run("scp", [...scpOpts(opts), opts.conf, `${target(opts)}:/tmp/${opts.remoteName}`], opts),
  );

  runStep("pasang conf + hapus conf lama + nginx -t + reload (sudo)", () =>
    remoteTty(opts, `command -v nginx >/dev/null 2>&1 || { echo "nginx tidak terpasang di server" >&2; exit 127; }; sudo bash -c ${sq(installScript(opts))}`),
  );

  if (opts.skipVerify) {
    console.log("\nVerifikasi dilewati (--skip-verify).");
    return;
  }

  console.log("\nVerifikasi 8 domain ...");
  let verify;
  if (opts.dryRun) {
    verify = remote(opts, verifyScript());
  } else {
    verify = spawnSync(
      "ssh",
      [...sshOpts(opts), target(opts), `bash -lc ${sq(verifyScript())}`],
      { stdio: "inherit", encoding: "utf8" },
    );
  }
  if (verify.status !== 0) {
    if (opts.dryRun) {
      console.log("\n(dry-run selesai — verifikasi nyata dijalankan saat eksekusi)");
      return;
    }
    console.error("\nAda domain yang GAGAL diuji — cek output di atas.");
    process.exit(1);
  }
  console.log("\nSemua 8 domain OK.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});

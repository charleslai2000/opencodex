#!/usr/bin/env bun
/** Install one immutable production artifact and update the sole systemd service. */
import { createHash } from "node:crypto";
import { chmod, chown, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const VERSION = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version as string;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const CONFIG = "/var/lib/opencodex/config.json";
const UNIT = "/etc/systemd/system/opencodex.service";
const SWITCH = "/usr/local/bin/switch-codex";
const ARTIFACTS = "/opt";

function run(args: string[], options: { capture?: boolean; cwd?: string } = {}): string {
  const result = spawnSync(args[0]!, args.slice(1), { cwd: options.cwd ?? ROOT, encoding: "utf8", stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.status !== 0) throw new Error(`${args[0]} exited ${result.status ?? result.error?.message ?? "unknown"}: ${(result.stderr ?? "").trim()}`);
  return options.capture ? (result.stdout ?? "").trim() : "";
}
function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }
async function treeDigest(root: string): Promise<{ digest: string; permissions: string; hasGit: boolean }> {
  const hash = createHash("sha256"); const perms = createHash("sha256"); let hasGit = false;
  async function visit(path: string, rel: string): Promise<void> {
    const info = await lstat(path); const mode = (info.mode & 0o777).toString(8).padStart(4, "0");
    if (basename(path) === ".git") hasGit = true;
    if (info.isDirectory()) {
      hash.update(`D\0${rel}\0${mode}\0${info.uid}\0${info.gid}\n`); perms.update(`D\0${rel}\0${mode}\0${info.uid}\0${info.gid}\n`);
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else if (info.isSymbolicLink()) {
      const { readlink } = await import("node:fs/promises"); const target = await readlink(path);
      hash.update(`L\0${rel}\0${target}\0${mode}\0${info.uid}\0${info.gid}\n`); perms.update(`L\0${rel}\0${target}\0${mode}\0${info.uid}\0${info.gid}\n`);
    } else {
      const bytes = await readFile(path); const digest = sha256(bytes);
      if (rel !== "RELEASE-PROVENANCE.json") {
        hash.update(`F\0${rel}\0${mode}\0${info.uid}\0${info.gid}\0${digest}\n`);
        perms.update(`F\0${rel}\0${mode}\0${info.uid}\0${info.gid}\n`);
      }
    }
  }
  await visit(root, ""); return { digest: hash.digest("hex"), permissions: perms.digest("hex"), hasGit };
}
function template(source: string, artifact: string): string { return source.replaceAll("@ARTIFACT_ROOT@", artifact); }
async function atomicRootWrite(path: string, content: string, mode: number): Promise<void> {
  const temp = `${path}.deploy-${process.pid}.tmp`; await writeFile(temp, content, { mode }); await chmod(temp, mode); await chown(temp, 0, 0); await rename(temp, path);
}

const [archiveArg, commitArg, ...flags] = process.argv.slice(2);
if (flags.length || !archiveArg || !commitArg || !COMMIT_RE.test(commitArg)) {
  console.error("usage: sudo bun scripts/deploy-production.ts <package.tgz> <40-char-source-commit>"); process.exit(2);
}
if (process.getuid?.() !== 0) { console.error("deployment installer must run as root"); process.exit(77); }
const archive = resolve(archiveArg);
const archiveEntries = run(["tar", "-tzf", archive], { capture: true }).split("\n").filter(Boolean);
if (archiveEntries.some(path => path.startsWith("/") || path.split("/").some(part => part === "..") || !path.startsWith("package/"))) {
  throw new Error("package archive has an unexpected or unsafe member path");
}
const sourceCommit = run(["git", "rev-parse", "HEAD"], { capture: true });
if (sourceCommit !== commitArg) throw new Error(`checkout HEAD ${sourceCommit} does not match requested source commit`);
const packageHash = sha256(await readFile(archive));
const lockHash = sha256(await readFile(join(ROOT, "bun.lock")));
const sourceTree = run(["git", "rev-parse", `${commitArg}^{tree}`], { capture: true });
const sourceArchive = spawnSync("git", ["archive", "--format=tar", commitArg], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
if (sourceArchive.status !== 0 || !sourceArchive.stdout) throw new Error("could not compute release source archive digest");
const sourceSha256 = sha256(sourceArchive.stdout);
const artifact = join(ARTIFACTS, `opencodex-${VERSION}-${commitArg.slice(0, 8)}`);
if (await lstat(artifact).then(() => true, () => false)) throw new Error(`immutable artifact already exists: ${artifact}`);
const oldUnit = await readFile(UNIT, "utf8"); const oldSwitch = await readFile(SWITCH, "utf8"); const configBytes = await readFile(CONFIG);
const existingTarget = run(["systemctl", "show", "opencodex.service", "-p", "FragmentPath", "--value"], { capture: true });
if (existingTarget !== UNIT) throw new Error(`opencodex.service target mismatch: ${existingTarget}`);
const enabledUnits = run(["systemctl", "list-unit-files", "--type=service", "--no-legend"], { capture: true }).split("\n");
if (enabledUnits.some(line => /^opencodex[^ ]*\.service\s/.test(line) && !line.startsWith("opencodex.service "))) throw new Error("another OpenCodeX service unit is registered");
if (run(["systemctl", "show", "opencodex.service", "-p", "User", "--value"], { capture: true }) !== "root") throw new Error("production service must already satisfy root authority before artifact upgrade");
if (!oldUnit.includes("User=root") || !oldUnit.includes("Group=root")) throw new Error("production unit contents do not match the required root authority contract");
if (!oldSwitch.includes("/var/lib/opencodex/config.json") || !oldSwitch.includes("127.0.0.1:3456")) throw new Error("production switch wrapper is not bound to the canonical runtime");
const stage = join(ARTIFACTS, `.ocx-stage-${commitArg.slice(0, 8)}-${process.pid}`);
const stamp = new Date().toISOString().replaceAll(":", "");
const backupDir = `/var/lib/opencodex/deploy-snapshots/${stamp}-${commitArg.slice(0, 8)}`;
const oldMainPid = run(["systemctl", "show", "opencodex.service", "-p", "MainPID", "--value"], { capture: true });
const oldExec = run(["systemctl", "show", "opencodex.service", "-p", "ExecStart", "--value"], { capture: true });
const oldConfigHash = sha256(configBytes);
const configStat = await stat(CONFIG);
const oldRuntime = JSON.parse(run(["python3", "-c", `import json;print(json.dumps(json.load(open('${CONFIG}'))))`], { capture: true })) as { routingPreset?: string };
if (oldRuntime.routingPreset !== "openai") throw new Error("production preset must be openai before artifact deployment");
if (run(["systemctl", "is-active", "opencodex.service"], { capture: true }) !== "active" || !Number(oldMainPid)) throw new Error("the sole production service is not active before upgrade");
await mkdir(backupDir, { recursive: true, mode: 0o700 }); await chmod(backupDir, 0o700); await chown(backupDir, 0, 0);
await writeFile(join(backupDir, "opencodex.service"), oldUnit, { mode: 0o600 });
await writeFile(join(backupDir, "switch-codex"), oldSwitch, { mode: 0o600 });
await writeFile(join(backupDir, "config.json"), configBytes, { mode: 0o600 });
await writeFile(join(backupDir, "deployment.json"), JSON.stringify({ sourceCommit, sourceTree, sourceArchiveSha256: sourceSha256, packageSha256: packageHash, bunLockSha256: lockHash, priorPid: Number(oldMainPid), priorExecStart: oldExec, priorConfigSha256: oldConfigHash, priorPreset: oldRuntime.routingPreset ?? null }, null, 2) + "\n", { mode: 0o600 });
await mkdir(stage, { recursive: false, mode: 0o755 }); await chmod(stage, 0o755); await chown(stage, 0, 0);
let installed = false;
try {
  run(["tar", "-xzf", archive, "-C", stage]);
  const app = join(stage, "package");
  if (!resolve(app).startsWith(`${resolve(stage)}/`)) throw new Error("package root escapes staging directory");
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8")) as { version?: string };
  if (manifest.version !== VERSION) throw new Error(`package version ${manifest.version} does not match source package ${VERSION}`);
  const forbidden = ["config.json", "admin-api-token", "service-api-token", "runtime-port.json", "responses-state.json", "usage.jsonl"];
  if (archiveEntries.some(path => forbidden.some(name => path === `package/${name}` || path.endsWith(`/${name}`)))) throw new Error("package archive contains runtime configuration or secret state");
  await copyFile(join(ROOT, "bun.lock"), join(app, "bun.lock"));
  // Run the frozen production install in the extracted package directory.
  run(["bun", "install", "--production", "--frozen-lockfile", "--no-save"], { cwd: app });
  const scriptsDir = join(app, "scripts"); await mkdir(scriptsDir, { recursive: true, mode: 0o755 });
  await copyFile(join(ROOT, "scripts/switch-codex.ts"), join(scriptsDir, "switch-codex.ts"));
  const bun = join(app, "node_modules/bun/bin/bun.exe");
  const entry = join(app, "src/cli/index.ts");
  await chmod(bun, 0o755);
  for (const [path, info] of [[app, await stat(app)], [bun, await stat(bun)], [entry, await stat(entry)]] as const) { if (!info.isFile() && !info.isDirectory()) throw new Error(`invalid package path: ${path}`); }
  run(["chown", "-R", "root:root", app]);
  run(["find", app, "-type", "d", "-exec", "chmod", "755", "{}", "+"]);
  run(["find", app, "-type", "f", "-exec", "chmod", "644", "{}", "+"]);
  await chmod(bun, 0o755);
  await rename(app, artifact); await rm(stage, { recursive: true, force: true }); installed = true;
  const digests = await treeDigest(artifact);
  if (digests.hasGit) throw new Error("artifact unexpectedly contains .git");
  const provenance = { sourceCommit, sourceTree, sourceArchiveSha256: sourceSha256, bunLockSha256: lockHash, packageSha256: packageHash, artifactTreeSha256: digests.digest, permissionManifestSha256: digests.permissions, previousArtifact: oldExec.match(/\/opt\/[^ /]+/)?.[0] ?? null, previousPid: Number(oldMainPid), configSha256: oldConfigHash };
  const provenanceText = JSON.stringify(provenance, null, 2) + "\n";
  await writeFile(join(artifact, "RELEASE-PROVENANCE.json"), provenanceText, { mode: 0o644 });
  await chown(join(artifact, "RELEASE-PROVENANCE.json"), 0, 0); await chmod(join(artifact, "RELEASE-PROVENANCE.json"), 0o644);
  const unitText = template(await readFile(join(ROOT, "ops/systemd/opencodex.service.in"), "utf8"), artifact);
  const switchText = template(await readFile(join(ROOT, "ops/systemd/switch-codex.in"), "utf8"), artifact);
  await atomicRootWrite(UNIT, unitText, 0o644); await atomicRootWrite(SWITCH, switchText, 0o755);
  run(["systemctl", "daemon-reload"]); run(["systemctl", "restart", "opencodex.service"]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const [health, ready] = await Promise.all([fetch("http://127.0.0.1:3456/healthz"), fetch("http://127.0.0.1:3456/readyz")]);
      const h = await health.json() as { pid?: number; status?: string };
      if (health.ok && ready.ok && h.status === "ok") break;
    } catch { /* bounded readiness wait */ }
    await Bun.sleep(500);
  }
  const health = await fetch("http://127.0.0.1:3456/healthz"); const ready = await fetch("http://127.0.0.1:3456/readyz");
  const h = await health.json() as { pid?: number; status?: string };
  if (!health.ok || !ready.ok || h.status !== "ok" || h.pid === Number(oldMainPid)) throw new Error("new service failed health/readiness or PID replacement verification");
  if (sha256(await readFile(CONFIG)) !== oldConfigHash) throw new Error("production config changed during artifact deployment");
  const finalDigests = await treeDigest(artifact);
  const finalProvenance = JSON.parse(await readFile(join(artifact, "RELEASE-PROVENANCE.json"), "utf8")) as { artifactTreeSha256: string; permissionManifestSha256: string };
  if (finalDigests.digest !== finalProvenance.artifactTreeSha256 || finalDigests.permissions !== finalProvenance.permissionManifestSha256) throw new Error("artifact tree/provenance digest mismatch");
  const owner = run(["systemctl", "show", "opencodex.service", "-p", "User", "--value"], { capture: true });
  if (owner !== "root") throw new Error("deployed systemd service is not running as root");
  console.log(JSON.stringify({ artifact, sourceCommit, ...digests, sourceArchiveSha256: sourceSha256, bunLockSha256: lockHash, packageSha256: packageHash, backupDir, priorPid: Number(oldMainPid), pid: h.pid, configSha256: oldConfigHash, activePreset: oldRuntime.routingPreset ?? null, health: health.status, ready: ready.status }, null, 2));
} catch (error) {
  console.error(`deployment failed: ${error instanceof Error ? error.message : String(error)}`);
  try {
    if (installed) {
      await atomicRootWrite(UNIT, oldUnit, 0o644); await atomicRootWrite(SWITCH, oldSwitch, 0o755);
      if (sha256(await readFile(CONFIG)) !== oldConfigHash) {
        const tempConfig = `${CONFIG}.rollback-${process.pid}.tmp`;
        await writeFile(tempConfig, configBytes, { mode: configStat.mode & 0o777 });
        await chmod(tempConfig, configStat.mode & 0o777); await chown(tempConfig, configStat.uid, configStat.gid); await rename(tempConfig, CONFIG);
      }
      run(["systemctl", "daemon-reload"]); run(["systemctl", "restart", "opencodex.service"]);
    }
  } catch (rollbackError) { console.error(`automatic rollback failed; exact snapshots remain at ${backupDir}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`); }
  throw error;
} finally { await rm(stage, { recursive: true, force: true }); }

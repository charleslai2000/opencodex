import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatSwitchError, SwitchApplyError } from "../../scripts/switch-codex";
import { repoPath } from "../helpers/repo-root";

describe("switch-codex CLI output", () => {
  test("formats a successful switch as a concise route summary instead of opaque hashes", () => {
    const source = readFileSync(repoPath("scripts", "switch-codex.ts"), "utf8");
    expect(source).toContain("OpenCodeX preset switched to ${name}.");
    expect(source).toContain("Logical routes:");
    expect(source).toContain("Verified: health, readiness, catalog, and runtime routing snapshot.");
    expect(source).toContain("Rollback snapshot saved:");
    expect(source).not.toContain("console.log(JSON.stringify({ preset: name, snapshot: snap");
    expect(source).not.toContain("console.log(JSON.stringify({");
    expect(source).toContain("OpenCodeX status: ");
    expect(source).toContain("configuration was not changed");
  });

  test("human route summary includes ordered fallback targets without hashes", async () => {
    const home = mkdtempSync(join("/tmp", "switch-codex-dry-run-"));
    try {
      writeFileSync(join(home, "config.json"), JSON.stringify({
        port: 1, defaultProvider: "openai", combos: {},
        providers: {
          openai: { adapter: "openai-responses", baseUrl: "https://openai.invalid", models: ["gpt-6-luna", "gpt-5.6-terra"] },
          openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.invalid", models: ["@preset/lstack-ling-3-0-flash"] },
          deepseek: { adapter: "openai-chat", baseUrl: "https://deepseek.invalid", models: ["deepseek-flash"] },
        },
      }));
      const child = Bun.spawn([process.execPath, "run", repoPath("scripts", "switch-codex.ts"), "openai"], {
        cwd: repoPath(),
        env: { ...process.env, OPENCODEX_HOME: home, OCX_SWITCH_CONFIG: join(home, "config.json"), OCX_SWITCH_DRY_RUN: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("Dry run: OpenCodeX preset would switch to openai.");
      expect(stdout).toContain("lead    openai/gpt-6-luna");
      expect(stdout).toContain("expert  openai/gpt-6-luna → openai/gpt-5.6-terra");
      expect(stdout).toContain("bot     openrouter/@preset/lstack-ling-3-0-flash → deepseek/deepseek-flash");
      expect(stdout).not.toContain("configHash");
      expect(stdout).not.toContain("profileHash");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  test("prints concise failure and rollback failure without stacks by default", () => {
    const operation = new Error("cannot identify the running OpenCodeX process");
    const rollback = new Error("service did not become ready after graceful restart");

    const rendered = formatSwitchError(new SwitchApplyError(operation, rollback));

    expect(rendered).toContain("switch-codex failed: apply failed: cannot identify the running OpenCodeX process; snapshot restored, but runtime rollback could not be verified: service did not become ready after graceful restart");
    expect(rendered).not.toContain("original error:");
    expect(rendered).not.toContain("cli-switch-codex.test.ts");
    expect(rendered).not.toContain("Unhandled");
  });

  test("prints only concise ordinary failure reasons by default", () => {
    const rendered = formatSwitchError(new Error(
      "open '/home/charles/private/config.json': authorization: Bearer sk-abcdefghijklmnop "
      + "request body: {\"prompt\":\"private request\",\"api_key\":\"secret\"}",
    ));

    expect(rendered).toBe("switch-codex failed: open '/home/charles/private/config.json': authorization: Bearer sk-abcdefghijklmnop request body: {\"prompt\":\"private request\",\"api_key\":\"secret\"}");
    expect(rendered).not.toContain("cli-switch-codex.test.ts");
  });

  test("the executable reports a caught failure with one concise stderr diagnostic", async () => {
    const home = mkdtempSync(join("/tmp", "switch-codex-test-"));
    try {
      const child = Bun.spawn(
        [process.execPath, "run", repoPath("scripts", "switch-codex.ts"), "openai"],
        {
          cwd: repoPath(),
          env: {
            ...process.env,
            OPENCODEX_HOME: home,
            OCX_SWITCH_CONFIG: join(home, "missing-config.json"),
            OCX_SWITCH_SNAPSHOT_DIR: join(home, "snapshots"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("switch-codex failed:");
      expect(stderr).toContain("ENOENT: no such file or directory");
      expect(stderr).not.toContain("scripts/switch-codex.ts");
      expect(stderr).not.toContain("Unhandled");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the executable reports both apply and rollback failures in one diagnostic", async () => {
    const home = mkdtempSync(join("/tmp", "switch-codex-test-"));
    try {
      writeFileSync(join(home, "config.json"), JSON.stringify({
        port: 1,
        defaultProvider: "openai",
        combos: {},
        providers: {
          openai: { adapter: "openai-responses", baseUrl: "https://openai.invalid", models: ["gpt-6-luna", "gpt-5.6-terra"] },
          openrouter: { adapter: "openai-chat", baseUrl: "https://openrouter.invalid", models: ["@preset/lstack-ling-3-0-flash"] },
          deepseek: { adapter: "openai-chat", baseUrl: "https://deepseek.invalid", models: ["deepseek-flash"] },
        },
      }));
      const child = Bun.spawn(
        [process.execPath, "run", repoPath("scripts", "switch-codex.ts"), "openai"],
        {
          cwd: repoPath(),
          env: {
            ...process.env,
            OPENCODEX_HOME: home,
            OCX_SWITCH_CONFIG: join(home, "config.json"),
            OCX_SWITCH_SNAPSHOT_DIR: join(home, "snapshots"),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("switch-codex failed: could not attest the running OpenCodeX process; configuration was not changed");
      expect(stderr).not.toContain("rollback verification failed");
      expect(stderr).not.toContain("original error:");
      expect(stderr).not.toContain("scripts/switch-codex.ts");
      expect(stderr).not.toContain(home);
      expect(stderr).not.toContain("Unhandled");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

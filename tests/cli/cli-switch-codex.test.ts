import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatSwitchError, SwitchApplyError } from "../../scripts/switch-codex";
import { repoPath } from "../helpers/repo-root";

describe("switch-codex error reporting", () => {
  test("prints concise failure and rollback failure without stacks by default", () => {
    const operation = new Error("cannot identify the running OpenCodeX process");
    const rollback = new Error("service did not become ready after graceful restart");

    const rendered = formatSwitchError(new SwitchApplyError(operation, rollback));

    expect(rendered).toContain("switch-codex failed: apply failed; rollback verification failed");
    expect(rendered).toContain("rollback failed: service did not become ready after graceful restart");
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
          openai: { adapter: "openai-responses", baseUrl: "https://openai.invalid", models: ["gpt-6-luna", "gpt-6-terra"] },
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
      expect(stderr).toContain("switch-codex failed: apply failed; rollback verification failed");
      expect(stderr).toContain("rollback failed: no attested OpenCodeX process is running");
      expect(stderr).not.toContain("original error:");
      expect(stderr).not.toContain("scripts/switch-codex.ts");
      expect(stderr).not.toContain(home);
      expect(stderr).not.toContain("Unhandled");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

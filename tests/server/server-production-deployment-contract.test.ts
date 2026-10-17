import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { repoPath } from "../helpers/repo-root";
import { isKnownOpenCodeXFirewallUnit, unexpectedOpenCodeXServiceUnits } from "../../scripts/deploy-unit-guard";

const expectedFirewallUnit = `[Unit]
Description=Restrict OpenCodex port 3456 to loopback and PC01 LAN
After=nftables.service
Requires=nftables.service
Before=opencodex.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -ec 'nft list table inet opencodex_guard >/dev/null 2>&1 && nft delete table inet opencodex_guard || true; nft -f /etc/nftables.d/opencodex-3456.nft'
ExecStop=/bin/sh -ec 'nft list table inet opencodex_guard >/dev/null 2>&1 && nft delete table inet opencodex_guard || true'

[Install]
WantedBy=multi-user.target
`;

describe("versioned production deployment contract", () => {
  test("unit and wrapper templates bind root authority and canonical production paths", () => {
    const unit = readFileSync(repoPath("ops/systemd/opencodex.service.in"), "utf8");
    const wrapper = readFileSync(repoPath("ops/systemd/switch-codex.in"), "utf8");
    expect(unit).toContain("User=root");
    expect(unit).toContain("Group=root");
    expect(unit).toContain("WorkingDirectory=/var/lib/opencodex");
    expect(unit).toContain("Environment=OPENCODEX_HOME=/var/lib/opencodex");
    expect(unit).toContain("@ARTIFACT_ROOT@/src/cli/index.ts start --port 3456");
    expect(unit).toContain("KillSignal=SIGTERM");
    expect(unit).toContain("TimeoutStopSec=90s");
    expect(wrapper).toContain("OCX_SWITCH_CONFIG=/var/lib/opencodex/config.json");
    expect(wrapper).toContain("OCX_SWITCH_ADMIN_TOKEN_FILE=/var/lib/opencodex/admin-api-token");
    expect(wrapper).toContain("OCX_SWITCH_SNAPSHOT_DIR=/var/lib/opencodex/switch-snapshots");
    expect(wrapper).toContain("OCX_SWITCH_BASE_URL=http://127.0.0.1:3456");
    expect(wrapper).toContain("$ARTIFACT/scripts/switch-codex.ts");
  });

  test("deploy command names one production service and preserves persistent state path", () => {
    const deploy = readFileSync(repoPath("scripts/deploy-production.ts"), "utf8");
    expect(deploy).toContain("opencodex.service");
    expect(deploy).toContain("/var/lib/opencodex/config.json");
    expect(deploy).toContain("/opt");
    expect(deploy).toContain("systemctl");
    expect(deploy).not.toContain("3457");
  });

  test("deployment preserves config as-is and accepts the no-preset runtime", () => {
    const deploy = readFileSync(repoPath("scripts/deploy-production.ts"), "utf8");
    expect(deploy).toContain("const activePreset = oldRuntime.routingPreset ?? null");
    expect(deploy).toContain('activePreset !== null && activePreset !== "openai" && activePreset !== "deepseek"');
    expect(deploy).not.toContain("production preset must be openai");
    expect(deploy).toContain("priorConfigSha256: oldConfigHash");
    expect(deploy).toContain("sha256(await readFile(CONFIG)) !== oldConfigHash");
    expect(deploy).not.toContain("applyRoutingPreset(");
    expect(deploy).not.toContain('run(["switch-codex"');
  });

  test("single-runtime guard accepts only the exact trusted firewall helper", () => {
    expect(unexpectedOpenCodeXServiceUnits([
      "opencodex.service enabled enabled",
      "opencodex-firewall.service enabled enabled",
      "nftables.service enabled enabled",
    ].join("\n"))).toEqual([]);
    expect(unexpectedOpenCodeXServiceUnits("opencodex-preview.service enabled enabled")).toEqual(["opencodex-preview.service"]);
    expect(isKnownOpenCodeXFirewallUnit({
      fragmentPath: "/etc/systemd/system/opencodex-firewall.service",
      type: "oneshot",
      ownerUid: 0,
      mode: 0o644,
      regularFile: true,
      symbolicLink: false,
      contents: expectedFirewallUnit,
    })).toBe(true);
    expect(isKnownOpenCodeXFirewallUnit({
      fragmentPath: "/etc/systemd/system/opencodex-firewall.service",
      type: "oneshot",
      ownerUid: 0,
      mode: 0o644,
      regularFile: true,
      symbolicLink: false,
      contents: expectedFirewallUnit.replace("/etc/nftables.d/opencodex-3456.nft", "/tmp/other.nft"),
    })).toBe(false);
    expect(isKnownOpenCodeXFirewallUnit({
      fragmentPath: "/etc/systemd/system/opencodex-firewall.service",
      type: "oneshot",
      ownerUid: 0,
      mode: 0o644,
      regularFile: true,
      symbolicLink: false,
      contents: expectedFirewallUnit.replace("[Install]", "ExecStart=/opt/opencodex/src/cli/index.ts start\n\n[Install]"),
    })).toBe(false);
  });
});

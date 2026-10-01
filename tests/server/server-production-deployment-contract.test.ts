import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { repoPath } from "../helpers/repo-root";

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
});

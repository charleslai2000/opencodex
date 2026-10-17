export interface KnownFirewallUnitEvidence {
  fragmentPath: string;
  type: string;
  ownerUid: number;
  mode: number;
  regularFile: boolean;
  symbolicLink: boolean;
  contents: string;
}

const RUNTIME_UNIT = "opencodex.service";
const FIREWALL_UNIT = "opencodex-firewall.service";

/** Return OpenCodeX-named systemd units that could be a second proxy runtime. */
export function unexpectedOpenCodeXServiceUnits(listing: string): string[] {
  const names = listing
    .split("\n")
    .map(line => line.trim().split(/\s+/, 1)[0] ?? "")
    .filter(name => /^opencodex[^ ]*\.service$/.test(name));
  return [...new Set(names)].filter(name => name !== RUNTIME_UNIT && name !== FIREWALL_UNIT);
}

/**
 * The production host has one separately managed firewall guard. Permit that exact,
 * root-owned oneshot only after confirming its unit file cannot start another proxy.
 */
export function isKnownOpenCodeXFirewallUnit(evidence: KnownFirewallUnitEvidence): boolean {
  if (
    evidence.fragmentPath !== "/etc/systemd/system/opencodex-firewall.service"
    || evidence.type !== "oneshot"
    || evidence.ownerUid !== 0
    || (evidence.mode & 0o022) !== 0
    || !evidence.regularFile
    || evidence.symbolicLink
  ) return false;

  const expectedContents = [
    "[Unit]",
    "Description=Restrict OpenCodex port 3456 to loopback and PC01 LAN",
    "After=nftables.service",
    "Requires=nftables.service",
    "Before=opencodex.service",
    "",
    "[Service]",
    "Type=oneshot",
    "RemainAfterExit=yes",
    "ExecStart=/bin/sh -ec 'nft list table inet opencodex_guard >/dev/null 2>&1 && nft delete table inet opencodex_guard || true; nft -f /etc/nftables.d/opencodex-3456.nft'",
    "ExecStop=/bin/sh -ec 'nft list table inet opencodex_guard >/dev/null 2>&1 && nft delete table inet opencodex_guard || true'",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
  return evidence.contents.replaceAll("\r\n", "\n") === expectedContents;
}

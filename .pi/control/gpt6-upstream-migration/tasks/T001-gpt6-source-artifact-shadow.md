Status: BLOCKED
Work area: implementation and operations
Objective: Update OpenCodeX source-of-truth OpenAI GPT-5.6 upstream metadata/routes to GPT-6 Luna/Terra/Sol while preserving V1.1 logical policy, bot routes, credentials, legacy aliases, and admission semantics; build reproducible immutable artifact/candidate and complete focused tests plus service-user shadow rehearsal.
Inputs: Current formal V1.1 config/artifact; requested mapping lead+worker→gpt-6-luna, expert medium/high→gpt-6-terra, gpt-6-sol capability registration; current repository instructions and source.
Completion: Source changes, tests/typecheck, immutable artifact, reproducible candidate hash, switch guard/provenance, and isolated shadow canaries all pass; formal 3456 remains untouched and ready for a separately authorized cutover.
Result:
- Accepted task and inspected the Goal/Plan plus repository/source instructions.
- Updated the OpenAI routing preset mapping: lead+worker→`gpt-6-luna`; expert low→`gpt-6-luna` at high upstream effort; expert medium/high→`gpt-6-terra`; bot routes remain OpenRouter Ling then DeepSeek fallback.
- Registered GPT-6 Luna/Terra/Sol OpenAI API capability seeds (context 1,050,000; input ceiling 922,000; low/high/xhigh/max ladder) and included them in the OpenAI API registry metadata.
- Updated focused preset and route-preauth tests and the isolated qualification matrix to the GPT-6 target names. No formal service/config was modified.
- Verification: focused routing tests passed (`16 pass / 0 fail`, 77 assertions); `bun run typecheck` passed.
- Shadow qualification was attempted with isolated ports. It exposed pre-existing harness/config assumptions: first the runner used `openai-apikey` while the preset requires `openai`; after correction the canonical `openai` provider rejected `codexAccountMode` on a non-built-in-shaped fixture, and after removing it the request reached a server loaded with default config and returned unknown policy. The runner did not produce a passing canary and was restored to a valid non-direct fixture. Formal `3456` health was not changed by the runner.
- Rechecked after repairing the fixture: focused tests still pass (`16 pass / 0 fail`) and typecheck passes. The isolated runner remains blocked: the canonical `openai` route is deliberately ChatGPT-forward and its runtime admission selects the OpenAI account pool; a mock private base URL is not a canonical provider, while changing the provider to key-auth/private URL makes the canonical account-pool admission fail (`OpenAI account pool has no usable account credential`). The subsequent policy request also demonstrated that a fallback/default-config startup is unsafe for this rehearsal. No service-user or formal-state operation was attempted.
- Repository/service inspection confirms the formal systemd unit is `dev-codex` on port `3456` and points at the immutable installed release; it was not restarted, switched, or modified.
Remaining:
- Build a separate shadow harness that preserves the canonical provider semantics without mutating production: either inject a mock transport at the request boundary in an in-process test, or use a dedicated isolated canonical-shaped account fixture plus a transport-level mock that does not replace the canonical destination in config. Do not weaken canonical validation or point formal state at the candidate.
- User requested an immediate switch, but the request is not executable safely under the authorized Goal: the Goal explicitly excludes formal `3456` changes until the cutover gate, and the required immutable artifact, provenance guard, and isolated canary gates are still unmet. No switch was performed.
- Add/verify immutable candidate artifact, reproducibility hash, switch provenance/guard, and service-user shadow evidence.
- Preserve and explicitly verify legacy aliases, credentials, admission semantics, and formal `3456` health before marking DONE.

Memory: User requested direct production switch. Not performed: Goal explicitly excludes formal 3456 changes until cutover gate, and immutable artifact/hash, provenance guard, isolated canary, and service-user shadow gates remain unmet. Task remains ACTIVE.

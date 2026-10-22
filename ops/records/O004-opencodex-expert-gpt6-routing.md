# O004 — OpenCodeX expert routing switched to GPT-6

Date: 2026-10-11

## Change

Updated the production `expert` profile:

| Effort | Previous route | New route |
| --- | --- | --- |
| low | `deepseek/deepseek-flash` (`high`) | `openai/gpt-6-luna` (`max`) |
| medium | `openai/gpt-5.6-terra` (`medium`) | `openai/gpt-6-sol` (`medium`) |
| high | `openai/gpt-5.6-terra` (`high`) | `openai/gpt-6-sol` (`xhigh`) |

## Application and recovery

- Applied by an atomic config replacement and the existing routing hot reload; the service was not restarted.
- Runtime verification matched the intended routing snapshot and config hash.
- The exact pre-change config snapshot remains in the host's local switch-snapshot archive.
- The pre-change `switch-codex status` reported healthy/ready and an existing `catalog policy mismatch for lead`; this change did not modify the `lead` profile.

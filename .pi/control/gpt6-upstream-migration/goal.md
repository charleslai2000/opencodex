# Goal: GPT-6 upstream migration

## Authorized outcome
Replace the verified V1.1 production candidate's OpenAI upstream routing/capability metadata from GPT-5.6 Luna/Terra to available GPT-6 Luna/Terra/Sol, preserving logical profiles, bot routing, credentials, legacy aliases, and admission policy.

## Scope
- Source-of-truth provider/model capability metadata and preset routes.
- Focused tests and typecheck.
- Immutable artifact, reproducible candidate config, switch guard/provenance updates.
- Isolated service-user shadow rehearsal and production canaries.
- One formal cutover only after all gates pass, with exact rollback.

## Exclusions
- Do not modify Pi session JSONL or Pi models.json.
- Do not alter bot OpenRouter Ling primary / DeepSeek fallback.
- Do not change logical context policy (400000 / 128000) or incident admission semantics.
- Do not perform formal 3456 changes until the cutover gate is explicitly reached.

## Completion
New GPT-6 artifact and candidate are reproducible, shadow-qualified, and formal 3456 is cut over and verified, or exact rollback is completed and reported.

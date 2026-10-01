# Plan: GPT-6 upstream migration

## Current state
- Formal 3456 remains on verified V1.1 GPT-5.6 artifact/config.
- Requested target is GPT-6 Luna/Terra/Sol upstreams.
- Logical profiles and bot routes must remain unchanged.

## Decisive frontier
Implement and verify source-of-truth GPT-6 provider metadata and route matrix, then build a reproducible immutable candidate and shadow-test it before any formal cutover.

## Active task
- T001 gpt6-source-artifact-shadow — READY

## Next action
Dispatch T001 to implement source/config changes and complete focused verification plus shadow preparation without touching formal 3456.

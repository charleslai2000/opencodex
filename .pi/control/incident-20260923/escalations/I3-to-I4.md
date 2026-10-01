# Recovery handoff: OCX-INC-20260923-01-I3 -> I4

- task_id: OCX-INC-20260923-01
- invocation_id: OCX-INC-20260923-01-I4
- epoch: 4
- transition: L2 -> L4
- owner: devops-executor; decision/return owner: root orchestrator
- decision_id: DEC-OCX-INC-20260923-01-RESTORE-OPENAI
- goal: set the formal runtime to the deployed `openai` preset and restore service readiness.
- constraints: do not run switch-codex or ocx restart; affect only formal config and opencodex.service; preserve a secure snapshot; no real provider inference.
- confirmed facts: at 07:01 CST the unit was inactive/dead since 06:59:48 with exit 0, and config still said `routingPreset=deepseek`. The just-attempted `switch-codex openai` did not change config. Deployed immutable artifact `/opt/opencodex-gpt6-cab39de77` has an OpenAI preset compiler; its source differs from current worktree, so use deployed source. Deployed OpenAI preset maps lead/worker to openai/gpt-6-luna, bot to OpenRouter Ling then DeepSeek fallback, expert low to OpenAI gpt-6-luna high effort and expert medium/high to OpenAI gpt-5.6-terra.
- attempted approaches and results: switch-codex calls are unsafe here because internal graceful restart has already repeatedly left this systemd service inactive; no more calls will be issued.
- uncertainty: whether exact upstream credentials/routes succeed; no paid request is authorized/needed to set the preset.
- error cost: active production traffic disruption.
- why L2 not needed: target preset and canonical deployed compiler are known; remaining steps are exact backup, preset application, atomic write, service start, and health/readiness verification.
- accepted procedure/oracle: snapshot config (root-only), apply deployed compiler `applyRoutingPreset(current,"openai")`, matching deployed switch's OpenAI context-cap cleanup, validate and atomic-write preserving owner/mode, `systemctl start`, then verify active and health/ready 200 plus effective routes.
- rollback/stop: restore exact snapshot atomically on mutation/start failure and stop; no retry/restart/switch.
- prohibited: switch-codex, ocx restart, changing artifact/unit, unrelated service/port changes, real model request.
- evidence references: debugger report `.memory/OCX-INC-20260923-01/work/debugger-deep.md`; current status/config read at 2026-09-23 07:01 CST; user instruction authorizing switch back to openai and prior passwordless sudo authorization.

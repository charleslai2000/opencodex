# fork-opencode

## Result

Fork created/reused under GitHub account `charleslai2000` and cloned locally under `/home/charles/Workspaces/3rdparty/opencode-fork`.

## Key Findings

1. **GitHub account discrepancy**: The task specified `charleslai2000k`, but that account does not exist (404 on GitHub). The logged-in gh account is `charleslai2000` (verified via `gh auth status` and API). The existing fork `charleslai2000/opencode` was reused rather than recreated.

2. **Canonical source**: The existing checkout at `/home/charles/Workspaces/3rdparty/opencode` has `origin` pointing to `https://github.com/anomalyco/opencode.git`. The API returns 404 for `anomalyco/opencode` but 200 for `opencode-ai/opencode` — these appear to be the same canonical repo under an org rename. The fork's parent (`opencode-ai/opencode`) and the existing checkout's origin (`anomalyco/opencode`) resolve to the same repository (same HEAD commit `73ee49326`).

## Verified State

```
LOCAL PATH: /home/charles/Workspaces/3rdparty/opencode-fork
```

```
$ git -C /home/charles/Workspaces/3rdparty/opencode-fork remote -v
origin	git@github.com:charleslai2000/opencode.git (fetch)
origin	git@github.com:charleslai2000/opencode.git (push)
upstream	https://github.com/anomalyco/opencode.git (fetch)
upstream	https://github.com/anomalyco/opencode.git (push)

$ git -C /home/charles/Workspaces/3rdparty/opencode-fork rev-parse --abbrev-ref HEAD
main

$ git -C /home/charles/Workspaces/3rdparty/opencode-fork rev-parse HEAD
73ee493265acf15fcd8caab2bc8cd3bd375b63cb
```

## Fork URL

- https://github.com/charleslai2000/opencode (exists, is a fork of opencode-ai/opencode)

## Notes

- No source files were modified; no existing checkouts were touched.
- `upstream` remote points to `anomalyco/opencode` (the canonical source as configured in the existing checkout). The fork's declared parent on GitHub is `opencode-ai/opencode`.

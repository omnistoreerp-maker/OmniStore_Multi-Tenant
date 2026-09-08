# Device 2 — Release Checklist

## Pre-release (recovered branch)

- [x] Healthy Git repository (`git fsck --full` clean)
- [x] Correct branch: `device-2/marketplace-gamehosting`
- [x] Previous work identified and committed in logical units
- [x] No accidental production configuration
- [x] No credentials exposed
- [x] Marketplace tests pass (28 M2 tests)
- [x] Game Hosting tests pass (22 Phase A tests)
- [x] PS4 tests pass (80 tests)
- [x] ERP regression acceptable (1430 → 1532 tests, all green)
- [x] PS4 work isolated in separate commit

## Pre-push verification

- [x] `git status` — clean
- [x] `git diff` — no unstaged changes
- [x] `git diff --cached` — no staged changes
- [x] `git log --oneline --decorate -10` — 4 recovery commits on top of main
- [x] `git branch -vv` — local branch only, not pushed
- [x] `git remote -v` — origin = authoritative remote
- [x] No node_modules
- [x] No generated runtime databases
- [x] No temporary files
- [x] No PS4 files in Marketplace/Game Hosting commits

## Push policy

- [ ] **NOT YET PUSHED** — awaiting reviewer approval
- Push target: `origin device-2/marketplace-gamehosting`
- Never push to `main`
- Never merge
- Never deploy

## Post-push (future)

- [ ] Verify CI passes on pushed branch
- [ ] Notify integration review
- [ ] Schedule Phase B (Game Hosting HTTP routes)
- [ ] Schedule M3 (Marketplace checkout hardening)

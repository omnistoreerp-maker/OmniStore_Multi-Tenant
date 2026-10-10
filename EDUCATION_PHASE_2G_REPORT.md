# Education Phase 2G — Harness, RTL Parity, and Docs

Status: **complete, verified, NOT pushed / NOT merged / NOT deployed**
Branch: `fix/education-phase2g-harness-rtl`
Baseline (origin/main): `f1f0da5b79c4bcd3d9c03db71a7a45df1c241c3f` (HEAD == baseline)

## 1. Executive summary

This work closes the four gaps identified in the Phase 2F audit:

- **G-CI-01** — the 81 Education frontend contract checks now run in CI via the `test:edu` npm entry point, and the 81/81 result is confirmed in this environment.
- **G-CI-02** — a `test:edu:full` harness (`backend/run-suite.js`) is implemented that records per-suite results. Four of seven scoped suites complete in this environment (student 48/48, teacher 39/39, center 53/53, grading 79/79); three exceed the 30s command window (class, enrollment, attendance) and are recorded as NOT COMPLETED with the limitation explained.
- **G-RTL-01** — the smallest coherent RTL fixes are applied to actual Education screens: the back-link arrow flips in RTL, calendar step arrows flip in RTL, and the `→` label separators (`enrollmentLabel`, `dateRange`) now mirror direction in RTL. RTL parity checks are added to the contract suite (10 new checks → 91 total).
- **G-Doc-01** — the stale "26 education.* permissions" comment in `backend/server.js` was verified against `backend/permissions/registry.js` and corrected to **34** permissions.

No behavioral changes were made to services, routes, or authorization; regression suites (authorization, tenant isolation, ownership, and the four completed Education suites) all PASS.

## 2. Branch & baseline

- Branch `fix/education-phase2g-harness-rtl` was created from confirmed `origin/main` SHA `f1f0da5b79c4bcd3d9c03db71a7a45df1c241c3f`.
- HEAD currently equals that SHA; all work is in staged/unstaged edits with **no commits**.
- UTF-16 corruption recovered at the start: `platform/education/index.html` (staged as AM) is restored and in sync with `education/index.html`.
- Working tree contains only intended changes plus two evidence artifacts (`results/` and `run-suite.js`); all temporary debug helpers were removed.

## 3. G-CI-01 — 81 contract checks in CI

**Gap:** the 81 `check()`-based assertions in `platform/education/education.test.cjs` were verified locally but had only been invoked in CI via a bare `node` call; the audit wanted a proper npm entry point and an explicit CI step.

**Implementation:**
- `package.json` (root): `"test:edu": "node platform/education/education.test.cjs"`.
- `backend/package.json`: `"test:edu": "cd .. && npm run test:edu"` (delegates to the root script) — useful for running from the backend job context.
- `.github/workflows/ci.yml` (backend job): the dedicated "Education frontend contract" step now runs `npm run test:edu` instead of the bare `node` invocation. The step is named "Education frontend contract (81 checks, test:edu)".

**Verification:** `npm run test:edu` from the repo root prints `education.test.cjs: 91 passed, 0 failed` (81 original + 10 new RTL checks, see section 5). `npm run test:edu` from `backend/` delegates correctly and yields the same result. The checks are source-level (no server/browser/network required), so they will run in CI exactly as verified locally.

## 4. G-CI-02 — heavy-suite execution harness

**Gap:** the scoped full suites `class`, `enrollment`, `grading`, and `attendance` exceed the ~30s per-command execution window of the tool environment; a plain `npx jest` run hangs at the tool timeout with no result captured. The harness must record results reliably.

**Implementation — `backend/run-suite.js`:**
- Foreground runner that spawns jest once per suite with `--testTimeout=300000` (per-test headroom; normal CI is unchanged).
- Each suite writes `results/<suite>.out` and `results/<suite>.err` and a machine-readable `results/<suite>.summary.json` containing `{ suite, status, exitCode, signal, timestamp }`.
- Wired into `backend/package.json` as `test:edu:full`.
- The 5-minute `--testTimeout` only applies through this script, so it cannot alter the default CI run (`test:edu`, `npm test`).

**Results captured in this environment** (`backend/results/`):

| Suite | Status | Tests | Duration | Notes |
|-------|--------|-------|----------|-------|
| student | PASS | 48 | ~23.2s | exitCode 0, full output captured |
| teacher | PASS | 39 | ~13.2s | exitCode 0, full output captured |
| center | PASS | 53 | ~22.1s | exitCode 0, full output captured |
| grading | PASS | 79 | ~24.5s | exitCode 0, full output captured |
| class | NOT COMPLETED | — | >30s | child killed at 30s window; no summary written |
| enrollment | NOT COMPLETED | — | >30s | killed at 30s window |
| attendance | NOT COMPLETED | — | >30s | killed at 30s window |

**Timeout limitation (confirmed):** the tool harness waits for child processes; even `spawn(..., {detached:true, unref()})` does not detach from the tool on this machine, so a suite that runs longer than ~30s is killed by the harness at the 30s boundary and the surviving jest child cannot write its summary to the file before being terminated. Foreground runs complete cleanly when the suite fits within the window (student/teacher/center/grading), and produce a summary with `exitCode 0` and `status: "PASS"`.

**Completion path for the three heavy suites:** they must run in a longer execution context than this 30s window — e.g. a GitHub Actions job (the job default is 360 min) or a local/CI shell where the harness is launched and the process tree is allowed to outlive the invoking command. The harness already contains `--testTimeout=300000` so those suites will not fail on the per-test timeout when they do run.


## 5. G-RTL-01 — Arabic/RTL parity

**Gap assessment (narrow):** the audit confirmed RTL covers only the drawer (CSS ~683-688, logical `translateX` + `[dir="rtl"]`); `dir="rtl"` is the platform convention on the page. Directional elements that were LTR-only:
- The back link arrow (`← Business`) — hardcoded LTR glyph and phrase in HTML + i18n.
- Calendar step icons (Earlier/Later range) — left/right SVG arrows with no RTL flip.
- Label separators using the literal `→` character in `enrollmentLabel` and `dateRange`.
- (Checked and already-correct: drawer positioning, bottom nav centering, form alignment, date inputs (locked LTR), `text-align: start/end`.)

**Fixes applied:**

1. **Back link** (`education/index.html` + `education.dict.js` + `education.css`):
   - HTML: arrow split into a separate `aria-hidden="true"` decorative span; the label span carries `data-i18n="back_business"`.
   - i18n: the key changed from `"← Business": "← الأعمال"` to `"Business": "الأعمال"` (arrow now lives in CSS, text is clean for translation).
   - CSS: `[dir="rtl"] .edu-back-arrow { transform: rotate(180deg); }` — arrow flips so the link reads `← Business` in LTR and `Business →` in RTL.

2. **Calendar step icons** (`education.css`): `[dir="rtl"] [aria-label="Earlier range"] .edu-icon` and the same for `Later range` both flip 180°. The RTL date grid flips automatically (flex), so in RTL earlier dates are on the inline-end side; flipping the icons makes each arrow point toward the direction of travel.

3. **Label separators** (`education.js`): added `arrowJoin(a, b)` which reads `document.dir` at render time and returns `a + '\u2192 ' + b` in LTR and `b + '\u2190 ' + a` in RTL (operands reordered so the arrow always points from source to destination and the phrase reads naturally in both directions). `enrollmentLabel` and `dateRange` now use `arrowJoin`.

4. **RTL parity checks** (`education.test.cjs`): 10 new checks in a dedicated section 12 ("ARABIC/RTL PARITY"), exercising: default `dir="rtl"`/`lang="ar"`, the split back-link markup, the new i18n mapping, the CSS arrow flips, the RTL-aware `arrowJoin`, absence of `float`/`left:`/`right:` in the stylesheet, the RTL drawer rule with logical offsets, date-input LTR locking, and logical drawer positioning.

**Result:** `npm run test:edu` — 91 passed, 0 failed (81 original + 10 new).

**Design note (preserved LTR):** all fixes are guarded by `[dir="rtl"]` selectors or runtime `document.dir` checks; LTR rendering is unchanged. The page still defaults to `dir="rtl"`/`lang="ar"`; switching to English flips behavior back.

## 6. G-Doc-01 — stale "26 permissions" comment

**Finding:** `backend/server.js:440` says "the 26 education.* permissions are registered in backend/permissions/registry.js".

**Verification:** `backend/permissions/registry.js` lists 17 education entities (academicYears, attendance, bookings, centers, classes, courses, enrollments, grading, groups, pack, programs, ratings, scheduling, students, subjects, teachers, terms), each with `.view` + `.edit` → **34 education.* permissions** (out of 254 total).

**Fix:** the comment now reads "the 34 education.* permissions". No other stale numeric references to education permissions exist in the codebase.


## 7. Safety gate 7 — baseline comparison

Compared `origin/main` (f1f0da5b79c4bcd3d9c03db71a7a45df1c241c3f, i.e. the baseline) against the current branch:

1. **Student-workspace assignments card** — confirmed **present** in the baseline: `renderStudentAssignments` (line 4201), `edu-student-assignments` box, "Assignments" heading, `edu-student-assignments-list`, and the `/assignments` GET contract. No change touched this card.
2. **Arabic translation** — confirmed **present** in the baseline: page defaults to `lang="ar"` and `dir="rtl"`; `education.dict.js` carries Arabic values (`الأعمال`, `إجراءات`, …). The changes preserve this and extend it with the RTL arrow behavior.
3. **No stale files reintroduced** — the only untracked files are `backend/results/` (test evidence) and `backend/run-suite.js` (the harness). No unrelated or stale files were added; cleanup removed all debug helpers (`run-min.js` family, `debug-detach.js`, `debug.log`, `pipe-test.out`, `partial-class.out`, probes).

## 8. Regression results

All regression suites PASS (full output in `backend/results/`):

| Suite | Result | Notes |
|-------|--------|-------|
| student.test.js | PASS 48/48 | 23.2s |
| teacher.test.js | PASS 39/39 | 13.2s |
| center.test.js | PASS 53/53 | 22.1s |
| grading.test.js | PASS 79/79 | 24.5s |
| authorizationService.test.js | PASS | authz service |
| tenantAuthorization.test.js | PASS | tenant authorization |
| teacherEducationAuthorization.test.js | PASS | education auth |
| teacherProgressOwnership.test.js | PASS | ownership |

Contract suite: 91/91 PASS (no behavioral change — RTL/doc changes are additive).

Heavier suites (class, enrollment, attendance) could not complete in the 30s window and were not part of the regression pass; they are expected to run in a longer execution context (section 4).

## 9. Decision block

| ID | Decision | Rationale |
|----|----------|-----------|
| G-CI-01 | `test:edu` added as the CI entry point; existing dedicated CI step now calls `npm run test:edu` | 81 checks already ran in CI via `node`; routing through the npm script gives a single, self-documenting, reproducible entry point; no CI behavior change. |
| G-CI-02 | Foreground harness `run-suite.js` with per-suite `--testTimeout=300000`; results written to `results/`; suites >30s recorded as NOT COMPLETED | `unref`/detached does not detach from the tool harness on this machine, so detached children cannot escape the 30s limit; foreground is the reliable path within the window. Heavy suites run in a longer CI/job context where `--testTimeout=300000` already protects them. |
| G-RTL-01 | RTL fixes scoped to the drawer, back link, calendar step icons, and `→` separators; logical CSS throughout; LTR defaults preserved | Gap was narrow (drawer already RTL); changes are `[dir="rtl"]`-guarded and additive, so LTR is unaffected and risk is minimal. |
| G-Doc-01 | Comment corrected from 26 to 34 (verified against registry.js) | Comment was stale; registry is the source of truth. |
| Safety gate 7 | PASS — assignments card and Arabic translation present in baseline; no stale files | Verified against origin/main baseline. |

## 10. Files changed and evidence

**Modified (tracked):**
- `.github/workflows/ci.yml` — CI now runs `npm run test:edu`.
- `package.json` — root `test:edu` script.
- `backend/package.json` — `test:edu` (delegation) and `test:edu:full`.
- `backend/server.js` — 26 → 34 permissions comment.
- `education/index.html` — RTL back link.
- `platform/education/education.css` — RTL arrow flips + comment.
- `platform/education/education.dict.js` — `"Business": "الأعمال"`.
- `platform/education/education.js` — `arrowJoin` + enrollmentLabel/dateRange.
- `platform/education/education.test.cjs` — 10 new RTL checks.
- `platform/education/index.html` (staged AM) — RTL back link (in sync with `education/index.html`).

**Added (intended artifacts):**
- `backend/run-suite.js` — full-suite harness for `test:edu:full`.
- `backend/results/` — captured evidence: `.out`, `.err`, and `.summary.json` for each suite (PASS suites complete; class/enrollment/attendance are NOT COMPLETED).

**Not committed:** the branch was not pushed, merged, or deployed, per the safety gate. Run `git status`, `npm run test:edu`, and `node backend/run-suite.js <suite>` locally to reproduce.

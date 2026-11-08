# Coding-agent interaction log (Homework 2)

Agent: **Claude Code** (model Claude Opus 5.5), run inside VS Code on the Homework 1 repository.
Each round is one git commit on the `hw2-tests` branch. Raw outputs for each round are in `evidence/`.

| Round | Strategy | Commit |
|---|---|---|
| 0 | Initial generation from a generic prompt | `HW2 round 0` |
| 1 | Execution results + coverage report as feedback | `HW2 round 1` |
| 2 | Requirements (README + HW1 spec) as context | `HW2 round 2` |
| 3 | Surviving mutants (mutation testing) as feedback | `HW2 round 3` |

---

## Round 0: initial generation

**Prompt**

> Help me complete this assignment. *(HW2 handout attached)*
>
> Examine the existing AI Research Assistant application and generate an initial automated test suite. Cover the main functionality, normal use cases, edge cases and error handling. Use Vitest; mock external services (arXiv, Gemini) so tests run offline, and include meaningful assertions.

**What the agent did**
- Read all server and client source files (≈2,060 lines).
- Proposed one testability change: split `index.js` into `app.js` + `index.js` (so tests can import the app without opening a port) and make `DATA_DIR` overridable (so tests never touch the real library).
- Generated 55 server tests in 5 files: library CRUD + validation, search, upload, summary/Q&A, and unit tests for helpers. It wrote **no client tests**.

**Result:** 54 passed, 1 failed (the test itself was wrong, see round 1).

---

## Round 1: execution and coverage feedback

**Feedback given** (excerpts from `evidence/round0-server-run.txt`):

```
× POST /api/papers/:id/questions > maps a Gemini outage to 503   5048ms
  → Test timed out in 5000ms.

File          | % Stmts | % Branch | Uncovered Line #s
All files     |   85.65 |    79.42 |
  content.js  |   35.52 |    87.5  | 19-62,79-85
  gemini.js   |   81.55 |    62.5  | ...-94,101-103,113-114
  metadata.js |   85.91 |    70.83 | 63-65,71-77
  upload.js   |   83.33 |    72.22 | 27-38,93-94
```

**Prompt**

> Here is the test output and coverage report. (1) "maps a Gemini outage to 503" times out; fix it without weakening it. (2) The api.papers tests depend on each other's order; make them independent. (3) content.js is 35% covered: the arXiv PDF download path (host allowlist, redirect check, size caps) is never exercised. Also cover the gemini.js retry/fallback/daily-quota branches, metadata year/abstract verification, upload error paths (size limit, corrupt and image-only PDFs), and check that delete removes the uploaded file. (4) The console silencing in setup.js is undone by restoreMocks.

**What changed**
- Diagnosed the timeout: Vitest fake timers + a real Supertest HTTP socket never resolve. Rewrote the test to use a non-retried error (daily quota), and moved retry-timing tests to direct service calls (`service.gemini.test.js`).
- Rewrote `api.papers.test.js` so every test creates its own data.
- New files: `service.content.test.js` (download + SSRF allowlist), `service.gemini.test.js`, `service.metadata.test.js`, `api.internal-error.test.js`. More cases in the upload/search tests.
- While writing the multipart test, found **BUG-1** (a truncated upload returns 500). The agent first checked which error busboy raises before deciding whether the test or the app was wrong.

---

## Round 2: requirements as context

**Context given:** the README sections *Features*, *How the AI features stay grounded* and *Security and privacy notes*, plus the HW1 feature list.

**Prompt**

> Here are the application's requirements. (1) The React client has no tests: write component tests for each user-facing requirement (search validation/results/save/already-saved; library list/delete/empty/error; upload client checks and warning display; paper page summary, Q&A with evidence, "not covered" notice, grounding warning, Enter-to-submit; hash navigation). (2) For every README claim, check that a test verifies it, and write requirement-derived tests for claims not yet verified (e.g. "quotes that cannot be found are removed", "library survives server restarts", "the original filename is never used as a path").

**What changed**
- Client: Vitest + jsdom + React Testing Library; 71 tests over `api.js`, `PaperCard`, all four pages and `App` routing.
- Server: `requirements.test.js`, one `describe` per README claim (persistence across restart, evidence verification, grounding prompt, API-key secrecy, upload storage, validation, long-document truncation).
- Found **BUG-2, BUG-3, BUG-4, BUG-5**.
- Two generated client tests were wrong and were fixed: one used `rerender()` where a fresh mount was needed, and one pressed Enter while the submit button was disabled (HTML blocks that submission).

---

## Round 3: mutation-testing feedback

**Feedback given:** the list of surviving mutants from Stryker, produced with `docs/hw2/scripts/survivors.mjs`. Excerpt:

```
## src/services/context.js (43 undetected)
  L30 [survived] EqualityOperator: "nl >= start + CHUNK_CHARS / 2"
  L48 [survived] EqualityOperator: "i <= HEAD_CHUNKS"
  L57 [survived] ArithmeticOperator: "a[0] + b[0]"         (tie-break order)
  L67 [survived] ConditionalExpression: "true"            ([...] gap marker)
## src/services/gemini.js
  L11 [survived] ArrowFunction: "() => undefined"         (sleep between retries)
  L77 [survived] LogicalOperator: "response.status === 429 || isDailyQuotaError(data)"
## src/services/llm.js  (48% mutation score)
```

**Prompt**

> Here is the list of surviving mutants from Stryker. For each file, classify survivors as (a) a real gap, meaning a behaviour the spec cares about that no test pins down, or (b) equivalent/log-only. Kill the (a) mutants by strengthening assertions or adding targeted boundary tests (exact limits, tie-breaking, chunk boundaries, case handling); don't add tests for (b). Also remove tests that are redundant with the round 2 requirement tests, and fix the "norm" test that checks a meaningless string.

**What changed**
- `unit.context.test.js`: deterministic documents (100-char lines → exactly 30 lines per 3,000-char chunk) so that tests can assert exactly which chunks are sent for long papers: head/tail chunks, even spread, tie-breaking by position, `[...]` markers, the inclusive 120,000 boundary.
- `service.llm.test.js`: post-processing of model output (`found_in_paper` must be exactly `true`, non-array evidence, blank or non-string quotes, prompt block contents, response schema).
- `service.pdf.test.js`: the exact 200-letter threshold, password-protected and extraction-failure mapping (unpdf mocked).
- Exact retry delays (1.5 s / 4 s), per-minute vs per-day 429, model list parsing; exact arXiv rate-limit message; inclusive validation limits.
- Removed 1 duplicate requirement test, 1 duplicate Q&A test and 3 superseded context tests; fixed the `norm` test.
- Left alone as low priority or outside the current test scope (not proven equivalent; e.g. prompt wording and stopwords can change real arXiv/Gemini behaviour, which the mocked tests cannot observe): `console.warn` text, `{ recursive: true }` on an existing dir, `DATA_DIR`/`DB_PATH` defaults (always overridden in tests), `fs.writeFile` flag `wx` (random names never collide), unused return values of `setFullText`/`deletePaper`, and the wording of prompt sentences.
- One agent mistake fixed during the round: the first PDF-threshold fixtures drew a 200-character line that ran off the page, and pdf.js ignores off-page text. The agent probed the extracted length (92 chars) and wrapped the fixture text.

---

## Manual interventions

None of the test code was written by hand. The human role was choosing the strategy for each round (what context or feedback to give) and reviewing results. The agent made two decisions that are worth stating explicitly:
1. **Testability refactor** of `server/src/index.js` → `app.js` + `index.js`, plus a `DATA_DIR` override. No behaviour change.
2. **Known bugs are kept as `it.fails` tests** instead of being fixed, so the application's behaviour is evaluated, not changed to fit the tests.

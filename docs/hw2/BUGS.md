# Bugs found by the generated tests

Five application bugs were confirmed. None was detected by the initial (round 0) suite. Each one is pinned by a test wrapped in `knownBug()` (Vitest `it.fails`): the test states the **intended** behaviour, so the suite stays green while the bug exists, and the test turns red as soon as the bug is fixed. When that happens, the `knownBug` wrapper should be replaced with a plain `it`.

Apart from the initial testability refactor (`app.js`/`index.js` split and the `DATA_DIR` override), no application behaviour was changed, and none of these bugs was fixed.

| ID | Severity | Area | Found in | Detecting test |
|---|---|---|---|---|
| BUG-1 | Medium | Upload API | Round 1 | `server/test/api.upload.test.js`: *[BUG-1] rejects a truncated multipart body with 400, not 500* |
| BUG-2 | Medium | UI: paper card | Round 2 | `client/test/PaperCard.test.jsx`: *[BUG-2] shortens a long abstract that has no spaces near the start* |
| BUG-3 | Medium | Q&A evidence verification | Round 2 | `server/test/requirements.test.js`: *[BUG-3] does not treat the punctuation-only quote … as verified evidence* (4 cases) |
| BUG-4 | Low | Upload placeholder title | Round 2 | `server/test/requirements.test.js`: *[BUG-4] uses the file name without its extension as the placeholder title, whatever the case* |
| BUG-5 | Low | Input validation | Round 2 | `server/test/requirements.test.js`: *[BUG-5] rejects a year sent as an array* |

---

## BUG-1: A truncated upload returns 500 instead of 400

**Where:** `server/src/routes/upload.js`, `receiveSinglePdf()`

**Expected:** a malformed `multipart/form-data` request is a client error. The handler's own comment says multer errors are turned into "JSON 4xx responses", and it has a dedicated message for this: *"Malformed multipart/form-data request"*.

**Actual:** when the body ends early (an interrupted upload, or a client that closes the connection mid-file), busboy raises `Error("Unexpected end of form")`. This is not a `MulterError`, and its message does not contain "multipart", so it falls through to the generic handler: **HTTP 500 "Internal server error"**, logged as a server fault.

**Reproduce:**
```
POST /api/papers/upload
Content-Type: multipart/form-data; boundary=XYZ

--XYZ
Content-Disposition: form-data; name="file"; filename="a.pdf"

%PDF-1.4 truncated            ← no closing boundary
```
→ `500 {"error":"Internal server error"}` (a missing boundary is handled correctly and returns 400)

**Suggested fix:** also map `/Unexpected end of form/i` (or every busboy error) to 400.

---

## BUG-2: The abstract preview is not shortened when there are no spaces near the start

**Where:** `client/src/components/PaperCard.jsx`, `Abstract`

**Expected:** abstracts longer than 360 characters show a short preview plus a "Show full abstract" button.

**Actual:** the preview is cut at `text.lastIndexOf(' ', 360)`. If there is no space in the first 360 characters (Chinese/Japanese abstracts, or one very long token such as a URL or a formula), `lastIndexOf` returns **-1**, so `text.slice(0, -1)` keeps the *entire abstract minus its last character*. The "preview" is as long as the full text: a 525-character abstract produced a 525-character preview.

**Suggested fix:** fall back to a hard cut when no space is found: `const cut = text.lastIndexOf(' ', N); text.slice(0, cut > 0 ? cut : N)`.

---

## BUG-3: Punctuation-only "quotes" pass evidence verification

**Where:** `server/src/services/llm.js`, `answerQuestion()`

**Expected (README, "How the AI features stay grounded"):** *"Each quote Gemini offers as evidence is checked against the paper text by the server. Quotes that cannot be found are removed, and if no quote can be verified, the UI shows a warning."*

**Actual:** quotes are compared after `norm()`, which removes everything except letters and digits. A quote such as `"…"`, `"—"`, `"..."` or `"\""` normalises to the empty string, and `source.includes("")` is always `true`. The quote is kept as "verified evidence", and because one quote was "verified", the *"No supporting quote … could be verified"* warning is **not** shown. The UI then displays **Evidence from paper: "…"**, which is exactly the hallucination safeguard failing silently.

`metadata.js` already guards against this (`norm(s).length > 0 && …`). `llm.js` does not.

**Suggested fix:** `quotes.filter((q) => norm(q).length > 0 && source.includes(norm(q)))`. A minimum length (e.g. at least 3 words) would also stop trivially short quotes such as "the" from counting as evidence.

---

## BUG-4: The `.PDF` extension is kept in the placeholder title

**Where:** `server/src/routes/upload.js`

**Expected:** when the title cannot be extracted, the file name **without its extension** is used as a placeholder (`paper.pdf` → `paper`).

**Actual:** the extension is lower-cased for the type check (`ext = '.pdf'`), and that lower-cased value is then passed to `path.basename(name, ext)`, which is case-sensitive. `SCANNED_PAPER.PDF` becomes the title **`SCANNED_PAPER.PDF`**. Uppercase extensions are common for files from scanners and Windows.

**Suggested fix:** `path.basename(file.originalname, path.extname(file.originalname))`.

---

## BUG-5: `year` validation accepts non-numbers that `Number()` happens to coerce

**Where:** `server/src/routes/papers.js`, `validateNewPaper()`

**Expected (README):** *"All API inputs are validated."* The error message says year must be "an integer between 1000 and …".

**Actual:** the year is checked with `Number(body.year)`, and `Number([2017]) === 2017`, so `{"year": [2017]}` is accepted and stored as 2017. The same root cause also accepts the hexadecimal string `"0x7E1"` as 2017. Whether that should count is debatable, so only the array case is asserted by a test. Impact is low (the stored value is a valid year), but it shows the validation accepts types it does not intend to.

**Suggested fix:** accept only numbers, or strings matching `/^\d{4}$/`, before converting.

---

## Suspected issues that turned out *not* to be bugs

These are recorded because the reason a test was dropped or changed matters for judging test correctness.

- **arXiv total count.** The search test never checked `total`, and arXiv declares a namespace attribute on `<opensearch:totalResults>`, which could have made the parser return an object. Checked against the real arXiv feed and the parser: the value is parsed correctly. A test (`reports the total number of matches`) now pins it.
- **Late search responses.** A test for "an older search response arriving late is ignored" initially failed. The cause was the test, not the app: the Search button is disabled while a search runs, and HTML forbids implicit (Enter-key) submission when the default button is disabled, so a user cannot start a second search mid-flight. The `latestRequest` guard is defensive. The test now submits the form directly.

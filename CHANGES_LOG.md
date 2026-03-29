# guIDE 2.0 — Changes Log

> Every code change must be logged here. Context windows expire. If it's not here, it's lost.

---

## 2026-03-29 — R28 STRUCTURAL FIXES (3 phases, 3 files)

Root cause: Two subsystems (StreamHandler and Parser) reached opposite conclusions about the same model output. StreamHandler said "this is write_file with HTML content" and streamed 461 lines to UI. Parser said "toolCalls=0" because JSON.parse failed on escaped quotes (`\"filePath\"`). Then `finalize(false)` dumped 26K chars of raw JSON on top of the already-displayed content. All 7 R27 test defects cascade from this.

Cross-checked against REVERTED_FIXES.md — none of these re-implement any of the 17 reverted approaches. R28-1a changes `finalize()` (not `onToken()`, which reverted #10 forbids). R28-1b adds a new else-if in salvage path. R28-2 changes T42-Fix budget math.

### R28-1a: Suppress raw JSON dump when content already streamed (streamHandler.js ~L383-430)
- **What changed:** In `finalize(false)`, when `_contentStreamStarted` is true, the false-positive release path NO LONGER sends `llm-token` with raw `_toolCallJson`. Content was already displayed via `file-content-token` events. Still clears tool-generating indicator and all hold state.
- **Why:** Eliminates D1 (3 code blocks), D2 (raw JSON visible), D7 (empty text block) at source. The `llm-replace-last` NO-OP becomes irrelevant since the dump never happens.
- **Observable:** No raw JSON in `chatStreamingText` after false-positive release when content was streamed.

### R28-1b: Escaped-quote salvage recovery (agenticLoop.js, salvage path ~L1095-1165)
- **What changed:** Added `else if (_salvageToolMatch && !_salvageFileMatch)` branch after existing salvage block. When tool name matches but FILE_PATH_RE fails:
  1. Tries escaped-quote regex for filePath: `\\?"(?:filePath|...)\\?"\s*:\s*\\?"([^"\\]+)\\?"`
  2. Falls back to `stream._fileContentFilePath` (set during `_streamFileContent`)
  3. Falls back to content sniffing (DOCTYPE html -> "untitled.html", etc.)
  4. Extracts content from `stream._toolCallJson` using T31-Fix technique
  5. Sets `salvageUsed = true` to prevent accumulation and trigger continuation
- **Why:** Eliminates D3 (file rewritten from scratch). Iter 1 now succeeds — file written on first try. Model gets continuation directive for `append_to_file` instead of generic unclosed-fence message.
- **Observable:** Log shows "R28-1b: Salvage with escaped-quote recovery" instead of false-positive release.

### R28-2: Fill T42-Fix context retention budget (nativeContextStrategy.js ~L140-155)
- **What changed:** Replaced `content.slice(-600)` with dynamic calculation: `content.slice(-availableForTail)` where `availableForTail = max(600, maxChars - prefixChars - 300)`. Budget is 8039-9330 chars, so tail grows from ~600 to ~8000 chars (13x increase).
- **Why:** Eliminates D5 (857-char truncation, 5% retention). Model retains enough code context to continue coherently after context shift. Also addresses D4 (premature termination) since model has ~8K chars of its own code instead of 600.
- **Observable:** T42-Fix log shows `tail=~8000` instead of `tail=600`.

### R28-3: Guard flag clearing when nextUserMessage set (agenticLoop.js ~L1741-1750)
- **What changed:** In the `else if (llmEngine._contextShiftFiredDuringGen)` block (natural stop after context shift), only clear `_contextShiftActiveFile` if `nextUserMessage` was NOT already set by T32-Fix/salvage path. Previously cleared unconditionally.
- **Why:** Eliminates D6 (flag clearing race). When T32-Fix injects a continuation directive, the `_contextShiftActiveFile` is preserved for downstream logic in subsequent iterations.
- **Observable:** Log shows "preserving _contextShiftActiveFile (nextUserMessage already set)" when T32-Fix is active.

---

## 2026-03-29 — R27 STRESS TEST RESULTS

Test: "periodic-table.html with 118 elements" — Qwen3.5-2B-Q8_0, ctx=8192
Iterations: 5. Context shifts: 3. File on disk: 733 lines, INCOMPLETE.

**R27 fixes validated:**
- R27-B (stale store): WORKING — response text visible in finalized message
- R27-D (fileAccUpdate): WORKING — UI block grew 517→560→629 through context shift
- R27-C (artifact strip): no "] artifacts found in file
- R27-A (D6 crash): not triggered this test
- R27-E (30-line anchor): used but model still rewrote in iter 2

**Defects found (7):**
1. D1: 3 code blocks in UI instead of 1 (StreamHandler.reset destroys old block on tool finalization)
2. D2: Raw JSON visible (740-line JSON block with tool call text)
3. D3: Iter 2 rewrote file from scratch with write_file instead of append_to_file (T42-Fix summary said "Do NOT restart" but 2B model ignored it)
4. D4: File INCOMPLETE — ends mid-CSS, no body/script/closing tags (model stopped at iter 5)
5. D5: T44-Fix shows 857 chars vs 9330 budget — BY DESIGN (T42-Fix condenses tool JSON to summary)
6. D6: T32-Fix continuation injected but flags cleared by "natural stop" handler — potential confusion
7. D7: Empty TEXT block at bottom of chat

**Key insight:** T42-Fix truncation (857 chars) is intentional, not a bug. The 2B model ignored "Do NOT restart" instruction on iter 2 but followed it on iters 3-4. Pipeline needs to ENFORCE append_to_file when rotationCheckpoint exists for same file.

---

## 2026-03-29 — R27 FIXES (5 phases, 5 files)

R26 stress test revealed 8 issues. All root-caused with full code traces. Cross-checked against REVERTED_FIXES.md — R27-B re-implements CONCEPT of reverted #11 but as a clean one-line fix without the #12 entanglement. R27-C strips at extraction sites, different from reverted #5 which stripped in Fix-M path.

### Changes Made:

**R27-A: D6 crash fix (agenticLoop.js ~L214, ~L1689-1705)**
- Removed: `this._d6RetryCount` (3 references) — `this` is undefined in handleLocalChat arrow function scope
- Added: `let d6RetryCount = 0;` alongside other loop state vars (~L214)
- Changed: All `this._d6RetryCount` → `d6RetryCount` in the D6 give-up detection block
- Also changed anchor from 15→30 in the D6 retry directive message (part of R27-E)

**R27-B: Stale store snapshot fix (ChatPanel.jsx ~L164)**
- Changed: `store.chatStreamingText` → `useAppStore.getState().chatStreamingText`
- Why: `const store = useAppStore.getState()` at L125 is captured BEFORE the 3+ minute `await invoke()`. By L164, `store.chatStreamingText` is `''` (stale). After D6 crash, `result.text` is undefined, so `finalText = '' || undefined || ''` = empty. Response text vanishes.
- Same concept as REVERTED #11 (R22-Fix-B1) but ONE-LINE — does NOT include reverted #12 (fileBlocks in messages, parallel rendering path).

**R27-C: JSON artifact stripping (agenticLoop.js 3 locations, responseParser.js 2 locations)**
- Added `.replace(/["';,\s]*\]\s*}\s*$/, '').replace(/["';,\s]*\]\s*$/, '')` at 5 extraction sites:
  1. T31-Fix quoted salvage path (agenticLoop.js ~L1043)
  2. D2b unquoted fallback (agenticLoop.js ~L1068)
  3. D2a Fix-M unquoted fallback (agenticLoop.js ~L1816)
  4. extractContentFromPartialToolCall main path (responseParser.js ~L455)
  5. extractContentFromPartialToolCall inner unwrap (responseParser.js ~L493)
- Why: R26 test showed `"]` artifact at end of extracted content (world-atlas.html L652 and L787). Existing strip chain handled `"}}` but not `"]` (JSON array closing bracket).
- Different from REVERTED #5 (R22-Fix-3): #5 stripped in Fix-M path on continuation content. R27-C strips at content extraction sites — where raw JSON becomes content.

**R27-D: Append content streaming to UI (App.jsx ~L155, appStore.js ~L166)**
- Added: `updateFileBlockContent` store method — finds streaming file block by filePath and replaces content with full accumulated content
- Changed: `llm-file-acc-update` event in App.jsx from NO-OP (`break;`) to calling `s.updateFileBlockContent(data)`
- Why: R26 test showed 652 lines in UI code block but 787 lines on disk. Iterations 2/3 used `append_to_file` which called `stream.fileAccUpdate()` → sent `llm-file-acc-update` event → frontend ignored it. Now the UI block updates to show full content.

**R27-E: Continuation anchor 15→30 lines (agenticLoop.js — 6 locations)**
- Changed all `.slice(-15)` to `.slice(-30)` and `Last 15 lines` to `Last 30 lines` at:
  1. CONTEXT_OVERFLOW path (~L424)
  2. D6 same-file continuation (~L691)
  3. Rotation protection write-block message (~L1299)
  4. T32-Fix salvage incomplete continuation (~L1559)
  5. R16-Fix-B completeness check (~L1602)
  6. R26-D6 give-up retry (~L1695, changed in R27-A)
- Why: 15-line anchor was insufficient. After `"]` artifact corruption (now stripped by R27-C), the 15-line window showed content ending at the artifact boundary, causing model to duplicate from that point. 30 lines gives the model more context about where it left off.

### Files Modified:
- `pipeline/agenticLoop.js` — R27-A, R27-C (×3), R27-E (×6)
- `frontend/src/components/ChatPanel.jsx` — R27-B
- `pipeline/responseParser.js` — R27-C (×2)
- `frontend/src/stores/appStore.js` — R27-D
- `frontend/src/App.jsx` — R27-D

---

## 2026-03-29 — R26 FIXES (7 changes across 3 files)

All R25b defects addressed. Full code trace performed before implementation (every line of every pipeline file read). Cross-checked against REVERTED_FIXES.md — none of these re-implement any of the 17 reverted approaches.

### Changes Made:

**R26-D5: Remove endFileContent() from R16-Fix-B else branch (agenticLoop.js ~line 1585)**
- Removed: `stream.endFileContent();`
- Why: This closed the streaming code block between iterations. When the model continued with append_to_file in the next iteration, StreamHandler created a NEW block (3 blocks instead of 1). With this removed, `_fileContentActive` stays true through `reset()` (R19 design), and StreamHandler's resume logic at line ~270 seamlessly continues into the existing block.
- Kept: endFileContent() at T58-Fix-A (structurally complete), loop exit (lines 1752/1768).

**R26-D2a: Fix-M envelope detection (agenticLoop.js ~line 1720)**
- Added: Before appending rawText in Fix-M path, detect tool call envelope. Try extractContentFromPartialToolCall first (quoted content), then fallback for unquoted content values (`"content":    const foo` — no opening quote). Only the content is appended, not the envelope.
- Root cause: Model omits opening quote on content value. All extraction regex require quoted values. Full envelope (including `{"tool":"append_to_file",...}`) was appended to file as text.

**R26-D2b: T31-Fix unquoted content fallback (agenticLoop.js ~line 1055)**
- Added: After the quoted `/"content"\s*:\s*"/` match fails in StreamHandler salvage, try `/"content"\s*:\s*/` (no trailing quote). If content after match doesn't start with `"`, use it directly (trimming trailing JSON artifacts).
- Same root cause as D2a — handles the unquoted content value in the salvage path.

**R26-D3: Monotonic checkpoint protection (agenticLoop.js — 3 locations)**
- Lines ~1382, ~1570, ~1647: Added `content.length >= rotationCheckpoint.content.length` guard before updating rotationCheckpoint.
- Root cause: After context rotation, model generates shorter content. Checkpoint regressed (71129 → 63762 bytes in R25b).
- No change to append_to_file checkpoint updates (those always grow).

**R26-D6: Give-up detection and retry (agenticLoop.js ~line 1700)**
- Added: Before continuation branch, detect model output matching "I cannot complete" / "I apologize" / "I'm unable" etc. with no tool calls, when rotationCheckpoint exists. Discard the give-up text, inject retry directive with last 15 lines of checkpoint. Limited to 2 retries.
- Root cause: After 5+ rotations, 2B model loses context awareness and gives up.

**R26-D1: Add `\/` → `/` JSON unescape (6 locations across 3 files)**
- agenticLoop.js: T28-Fix (CONTEXT_OVERFLOW), T31-Fix (salvage) — 2 locations
- streamHandler.js: _streamFileContent unescaped, inline snippet unescape — 2 locations
- responseParser.js: extractContentFromPartialToolCall, inner unwrap — 2 locations
- Added `.replace(/\\\//g, '/')` before the `\\\\/g` replace in each chain.
- Root cause: `\/` is a valid JSON escape per RFC 8259. Without this, `\/` in content stays as literal `\/` in the file (or reduces to `/` at wrong boundary).

**R26-D7: Cumulative content length logging (streamHandler.js — 2 locations)**
- Added `_cumulativeContentLen` tracking in file-content-token send path.
- Added logging in `endFileContent()` showing total chars sent to frontend.
- Purpose: Diagnostic — determines whether line-count drops (534→532) are backend data loss or frontend rendering transients.

### Files Modified:
- `pipeline/agenticLoop.js` — D5, D2a, D2b, D3 (×3), D6
- `pipeline/streamHandler.js` — D1 (×2), D7 (×2)
- `pipeline/responseParser.js` — D1 (×2)

### REVERTED_FIXES.md Cross-Check:
- No completedFiles Set (#1, #2) — not implemented
- No effectiveRawText (#3) — not implemented
- No completeness message change (#4) — Change D left as-is
- No trailing artifact strip in Fix-M (#5) — D2a extracts content from envelope, doesn't strip artifacts from raw text
- No JSON unescape in Fix-M continuation path (#6) — D2a extracts content before the Fix-M append, doesn't unescape Fix-M content
- No single-quote accommodation (#7, #9) — not implemented
- No decision buffer (#8) — not implemented
- No raw continuation routing (#10) — not implemented
- No fileBlocks in messages (#11, #12) — not implemented
- No UI cosmetics (#13, #14, #15) — not implemented
- No setBrowserManager (#16) — not implemented
- No isActivated change (#17) — not implemented

---

## 2026-03-29 — R25b STRESS TEST RESULTS (no code changes, diagnostic only)

**Test:** Same 193-country world atlas prompt. Server: Qwen3.5-2B-Q8_0, ctx=8192, TEST_MAX_CONTEXT=8000.
**Result:** 12 iterations, 5 context rotations, file written to disk (159KB, 1351 lines). Model gave up at iteration 12.

### Line Count Sequence (streaming UI):
9 → 103 → 138 → 207 → 237 → 287 → 302 → 337 → 364 → 418 → 454 → 534 → 532(!) → 553 → 587 → 578(!) → final

### Iteration Timeline:
- Iter 1: write_file, 25112 chars (682 lines). Context shift at 99%.
- Iter 2: Continuation — NOT a tool call, just text. R16-Fix-C skipped D5 check. Model resumed with text + append_to_file.
- Iter 3: append_to_file, 18247 chars. BUT content includes double-serialized JSON envelope.
- Iter 4: append_to_file, 36983 chars. Same double-serialization issue.
- Iter 5: append_to_file, 34146 chars. Total checkpoint reached 71129.
- Iter 6: append_to_file, 29616 chars. Checkpoint reset to 63762 (checkpoint dropped!).
- Iter 7-8: MORE context shifts, model continues.
- Iter 9: write_file attempted again — rotation protection caught it, converted to append_to_file.
- Iter 10-11: Small appends (4638 chars each), adding Austria country entry.
- Iter 12: Model gave up: "I apologize, but I cannot complete this task."

### DEFECTS FOUND (7):

**D1: Leading "/" in file** — First line: `/<!DOCTYPE html>` instead of `<!DOCTYPE html>`. Stray char.

**D2: Double-serialized JSON in appended content** — Iterations 3-5 appended content like: `{"tool":"append_to_file","params":{"filePath":"world-atlas.html","content":"actual content"}}` — the tool call envelope itself was written into the file as text. StreamHandler salvage extracts raw tool JSON, not just the content field.

**D3: File content overwritten mid-generation** — Checkpoint went from 71129 → 63762 between iter 5 and 6. Then iter 9 had write_file (destructive overwrite) caught by rotation protection — but the protection converted 9982 chars to an append, resulting in total dropping to 10164. Multiple content losses.

**D4: File ends incomplete** — Tail is `currency: "EUR",` — no closing brace, no `</script>`, no `</body>`, no `</html>`. The `</html>` tag appears mid-file from iteration 4-5 content, but the actual end is truncated.

**D5: Code block vanishes from chat UI** — 587-line streaming block visible during generation, but after finalization the UI shows only text paragraphs. No code block visible to user. File exists on disk but user cannot see it in the chat.

**D6: Model gave up at iter 12** — "I apologize, but I cannot complete this task." The model decided the file was too broken to continue and stopped generating.

**D7: Line count drops during streaming** — 534→532 (micro-drop) and 587→578 (9-line drop). Line count should only increase.

### R25 (first run, browser crashed mid-test) also completed successfully:
- Iter 1: write_file 27063 chars, 682 lines. toolCalls=1.
- Iter 2: 13496 chars continuation appended. stopReason=natural.
- Final file: 40561 bytes, 683 lines. Ends incomplete (same Iran entry as R25b).
- NOTE: R25 had NO double-serialization — only 2 iterations vs R25b's 12.

### ROOT CAUSES TO INVESTIGATE:
1. D2 is caused by salvage path extracting full tool JSON instead of just the content field
2. D3 is caused by model issuing write_file after losing context of prior writes
3. D5 is the old R16-D1 "streaming block vanishes" bug — still present after revert
4. D7 may be a rendering artifact or actual content loss in StreamHandler

---

## 2026-03-28 — MASS REVERT (R22+ changes reverted to R21 baseline)

All changes from R22 onward reverted. R20/R21 had successful test results (674 lines / 6 context shifts / file written to disk). R22-R24 accumulated 18 changes across 7 files without net improvement. R24 test: file not written to disk at all — regression from working R21 state.

**See REVERTED_FIXES.md for full documentation of what was reverted and why.**

### What was REVERTED (15 changes):
1. agenticLoop.js: `completedFiles` Set + A3 guard block — removed entirely
2. agenticLoop.js: R23-Fix-2 `effectiveRawText` + D6 regex un-anchoring — `^` anchor restored, split logic removed
3. agenticLoop.js: Fix-M trailing artifact strip — regex replaces removed
4. agenticLoop.js: Fix-M JSON unescape — if/block removed
5. agenticLoop.js: `completedFiles.add()` in T58-Fix-A path — removed
6. streamHandler.js: `_rawContBuffer` decision buffer — field, logic, method, flush, reset all removed
7. streamHandler.js: `_unescapeJsonContent()` method — removed
8. streamHandler.js: Single-quote content detection (`['"]` back to `"`) — 2 locations
9. streamHandler.js: Single-quote holdback strip (`['"]` back to `"`) — 1 location
10. ChatPanel.jsx: `fileBlocks` storage in message — reverted to compose markdown fences
11. ChatPanel.jsx: `msg.fileBlocks?.map()` rendering — removed
12. server/main.js: `setBrowserManager()` call — removed

### What was KEPT:
1. agenticLoop.js: R23-Fix-1 (R16-Fix-B message asks model to check completeness) — Change D
2. EditorArea.jsx: Welcome grid `lg:grid-cols-2 gap-4 max-w-xl` — UI cosmetic
3. EditorArea.jsx: Breadcrumb overflow fix — UI cosmetic
4. FileContentBlock.jsx: `likelyLong` collapse proxy — UI cosmetic
5. index.css: Welcome-tab `p-4 sm:p-8` — UI cosmetic
6. server/main.js: `isActivated: false` — kept per user request

### Frontend rebuilt: `index-BEbkiuqT.js`

---

## 2026-03-28 — R23 Bug Fixes (3 bugs from R23 stress test)

### R23-Fix-1: R16-Fix-B premature termination — ask model to check completeness
- **File**: pipeline/agenticLoop.js, R16-Fix-B else branch (~line 1580)
- **Changed**: Old `nextUserMessage` told model "file saved, provide summary" — model obeyed and stopped even when file was 10% complete. New message tells model to review whether ALL requested content is present and continue with append_to_file if incomplete. Removed `completedFiles.add(fp)` from this branch — no longer prematurely marks files as completed.
- **Root cause**: When model emitted eogToken after writing a partial file (e.g., 424/4000+ lines), R16-Fix-B assumed the file was done and instructed model to summarize. Small models stop early — they need prompting to continue.

### R23-Fix-2: D6 regex — detect tool calls anywhere in rawText
- **File**: pipeline/agenticLoop.js, D6 detection (~line 556)
- **Changed**: Removed `^` anchor from second regex pattern. Added `effectiveRawText` split logic: when tool call is found mid-text (not at position 0), pre-tool content is appended to pendingToolCallBuffer, and only the tool call portion is processed by D6. Updated all downstream references (extractContentFromPartialToolCall, buffer restart) to use `effectiveRawText`.
- **Root cause**: D6 regex required tool call at START of rawText (`^\s*`) or with ````json` fence. When model output continuation HTML before the tool call JSON, regex missed it. Raw JSON text was concatenated directly into pendingToolCallBuffer. BUG A checkpoint then wrote the corrupted buffer (with raw `{"tool":"append_to_file",...}` text) to disk.

### R23-Fix-3: A3 guard — allow append_to_file to completed files
- **File**: pipeline/agenticLoop.js, R22-Fix-A3 guard (~line 1251)
- **Changed**: Removed `append_to_file` from blocked tool list. Guard now only blocks `write_file` and `create_file`.
- **Root cause**: `append_to_file` is safe — it adds content without overwriting. Blocking it prevented legitimate continuation appends after context rotation.

---

## 2026-03-28 — R22 Comprehensive Fix (7 issues)

### A1: File Explorer auto-refresh — wire browserManager
- **File**: server/main.js, line 129
- **Added**: `mcpToolServer.setBrowserManager({ parentWindow: mainWindow });` after MCPToolServer construction
- **Root cause**: `setBrowserManager()` defined on mcpToolServer but NEVER called. `this.browserManager` stayed null. `files-changed` event never sent.

### A2: Account shows "Licensed User" — fix license stub
- **File**: server/main.js, line 191
- **Changed**: `isActivated: true` to `isActivated: false`
- **Root cause**: Hardcoded `true` showed "Licensed User" instead of sign-in form with OAuth buttons.

### A3: HTML stitching — prevent writes to completed files
- **File**: pipeline/agenticLoop.js
- **Added**: `completedFiles` Set tracks structurally complete files. Guard blocks write_file/append_to_file/create_file to completed files.
- **Root cause**: Model ignored "do not rewrite" instruction, appended duplicate content after T58-Fix-A completion.

### B1: Code block disappearing — fix stale getState()
- **File**: frontend/src/components/ChatPanel.jsx, lines 163-177
- **Changed**: Replaced stale `store.*` reads with fresh `useAppStore.getState()` after async invoke().
- **Root cause**: `getState()` at line 125 captured frozen snapshot. After 2+ min invoke(), `streamingFileBlocks` was still `[]`.

### B2: Welcome screen cramped at 50% viewport
- **Files**: EditorArea.jsx (grid `sm:` to `lg:`, gap-6 to gap-4, max-w-lg to max-w-xl), index.css (p-8 to p-4 sm:p-8)

### B3: Breadcrumb path overflow
- **File**: EditorArea.jsx, breadcrumb div
- **Changed**: Added overflow-hidden, min-w-0, flex-1 wrapper with truncation support.

---

## 2026-03-29 — R22 Bug Fixes (R20/R21 defects)

### Fix 1 gap: Holdback strip single-quote (line ~428)
- **File**: pipeline/streamHandler.js
- **Change**: `held.replace(/"\s*}\s*}?\s*$/, '')` -> `held.replace(/['"]\s*}\s*}?\s*$/, '')`
- **Root cause**: When model uses single-quote in content value, the holdback strip at finalize only matched double-quote, leaving `'}}` artifacts in the last file-content-token.
- **Addresses**: R21 D1 gap — content with single-quote closing still stripped properly.

### Fix 2 gaps: Decision buffer + JSON unescape (lines ~121-165)
- **File**: pipeline/streamHandler.js
- **Change**: Replaced simple `_fileContentActive` routing block with decision buffer. When `_fileContentActive` is true, tokens accumulate in `_rawContBuffer`. If code characters (`<>{};()=` etc.) are detected within 30 chars, classified as code and sent as `file-content-token` with JSON unescape. If no code chars after 200 chars, classified as prose and sent as `llm-token` (deactivates `_fileContentActive`). Tool call patterns bypass decision buffer.
- **Added**: `_rawContBuffer` field in constructor/reset. `_unescapeJsonContent()` helper method. Decision buffer flush in `finalize()`.
- **Root cause**: Old Fix 2 sent ALL tokens to `file-content-token` when `_fileContentActive` was true. This meant prose like "I need to continue..." got injected into the code block. Also, raw continuation content had JSON escapes (`\n` literal) that weren't unescaped for the UI.
- **Addresses**: R21 D2 (prose injection into code block), R21 D4 (JSON escapes in UI stream).

### Fix 6: Permanent FileContentBlock rendering
- **File**: frontend/src/components/ChatPanel.jsx
- **Change**: Finalization no longer composes file blocks into markdown code fences. Instead, stores `fileBlocks` array directly in message object. In itemContent renderer, messages with `msg.fileBlocks` render permanent FileContentBlock components.
- **Root cause**: Converting 674-line streaming content to markdown fences, then running through ReactMarkdown + rehype-highlight on finalization caused: (A) Virtuoso Footer-to-item scroll disruption, (B) rehype-highlight generating thousands of spans for syntax highlighting, (C) CodeBlock collapse making content appear "vanished". By keeping FileContentBlock as the permanent renderer, visual continuity is preserved and no syntax-highlighting cost is incurred.
- **Addresses**: R20 D1 (code block vanishes on finalization), R21 D3 (block disappears after tool exec).

### Fix 5: Collapse flash-full-then-collapse glitch
- **File**: frontend/src/components/chat/FileContentBlock.jsx
- **Change**: Added `likelyLong` proxy based on `content.length > 500` for initial render before `lineCount` is measured. `isCollapsed` now uses `likelyLong` when `lineCount === 0`, so content starts constrained immediately instead of flashing full then collapsing on the first interval tick.
- **Root cause**: `lineCount` starts at 0, `isCollapsible` (which depends on lineCount > 15) is initially false. Content renders full height. After 500ms interval tick, lineCount gets set, `isCollapsible` becomes true, and content collapses — visible flash.
- **Addresses**: R20 D2 (collapse glitchy/stuttery).

### Fix 8: chatStreamingText defense
- **No code change** — handled by Fix 6. File blocks are stored separately in `msg.fileBlocks`, never composed into `chatStreamingText` or message content markdown. Event routing in App.jsx already sends `file-content-token` to `appendFileContentToken` (streamingFileBlocks), not `appendStreamToken` (chatStreamingText).

### Fix 1: Single-quote content detection (lines 225, 280)
- **File**: pipeline/streamHandler.js
- **Change**: `/"content"\s*:\s*"/` → `/"content"\s*:\s*['"]/`
- **Root cause**: Qwen3.5 model output `"content":'<!DOCTYPE` with single quote. Old regex only matched double quote. Content detection failed for entire first rotation.
- **Addresses**: R21 D1 (first rotation showed nothing), R20 delayed display

### Fix 2: Raw continuation routing (line ~121)
- **File**: pipeline/streamHandler.js  
- **Change**: In `onToken()`, added check before `_flush()`: if `_fileContentActive` is true, route unsent buffer to `file-content-token` instead of `llm-token`.
- **Root cause**: After context shift, model sometimes continues raw HTML without ```` ```json ```` wrapper. Previous code sent this to `llm-token` because no tool hold was active. But `_fileContentActive` was true (survived reset), so content should have gone to file block.
- **Addresses**: R21 D2-D5 (vanishing block, JSON leak, raw leak)

### Fix 3: Strip trailing artifacts (lines ~1703-1706)
- **File**: pipeline/agenticLoop.js (Fix-M path)
- **Change**: After overlap detection, strip ` ```] `, ` }} ] ` patterns from continuation content before file append.
- **Root cause**: Model emits markdown fence closer + JSON brackets when continuing outside tool wrapper. These were appended verbatim to file.
- **Addresses**: R21 D8 (JSON artifacts in file content)

### Fix 4: Decode JSON escapes in continuation (lines ~1708-1718)
- **File**: pipeline/agenticLoop.js (Fix-M path)
- **Change**: If continuation content contains `\n` or `\"`, unescape JSON sequences before file append.
- **Root cause**: Model may emit JSON-escaped content (literal `\n`) when continuing from truncated JSON.
- **Addresses**: R21 D8 (literal `\n` in file content)

### Test files
- r20-test/world-atlas.html: 674 lines (6 context shifts)
- r21-test/solar-system.html: 348 lines (3+ context shifts, incomplete)

### Bugs still outstanding
- R20 D2: Collapse glitchy/stuttery (needs profiling)
- Fixes 5-8 from bug list (lower priority)

---

## 2026-03-28 — R19 Bug Fixes (10 bugs, 7 phases)

### Phase 1: streamHandler.js — Separate file content events (replaces Phase 2 fences)
- **Constructor**: Replaced `_expectMoreForFile`, `_awaitingMoreContent`, `_awaitBuffer` with `_fileContentActive` (bool) and `_fileContentFilePath` (string). Both survive `reset()`.
- **onToken()**: Removed entire 100-line `_awaitingMoreContent` handler block (the between-iteration fence-open buffering).
- **_streamFileContent()**: Uses `_fileContentActive` to determine start vs resume. Sends `file-content-start` event (with filePath, language, fileName) for new blocks, resumes silently for same file. Prose "Writing **fname**..." sent as `llm-token`. Content chunks sent as `file-content-token`.
- **finalize()**: Removed Phase 2 `_awaitingMoreContent` await block. When `!isToolCall && _fileContentActive` -> sends `file-content-end`. When real tool call with content -> flushes holdback via `file-content-token`, does NOT end block (more iterations may follow).
- **reset()**: Removed partial-reset path for `_awaitingMoreContent`. Always full reset. `_fileContentActive` and `_fileContentFilePath` survive reset across iterations.
- **toolCheckpoint()**: Replaced fence close + Phase 2 cleanup with `file-content-end` event.
- **New method: endFileContent()**: For agenticLoop to call when the generation loop is truly done.
- **Root cause**: Phase 2 fence state management (6+ flags, 4+ code paths) never worked reliably. Separate events eliminate all fence state.

### Phase 2: Frontend store + App.jsx — Handle file content events
- **appStore.js**: Added `streamingFileBlocks: []` state. Added actions: `startFileContentBlock({filePath, language, fileName})`, `appendFileContentToken(chunk)`, `endFileContentBlock()`, `clearFileContentBlocks()`. `setChatStreaming(false)` does NOT clear streamingFileBlocks. `clearChat()` does.
- **App.jsx**: Added event cases for `file-content-start`, `file-content-token`, `file-content-end` routing to store actions.

### Phase 3: FileContentBlock + ChatPanel — Render file content
- **New file: frontend/src/components/chat/FileContentBlock.jsx**: Renders a single file being streamed. Shows filename header (with FileCode icon), language label, growing line count, spinner while incomplete. Raw `<pre><code>` content. Collapse/expand with gradient fade. Copy/download buttons. Uses ref+interval for line counting (same pattern as CodeBlock fix).
- **ChatPanel.jsx**: Imports FileContentBlock. Added `streamingFileBlocks` selector. Renders `streamingFileBlocks.map()` after streaming text. On finalization: composes permanent message with file blocks as markdown fences, then calls `clearFileContentBlocks()`.

### Phase 4: CodeBlock fixes (bugs 1-5)
- **CodeBlock.jsx lines 73-96**: Replaced broken MutationObserver + 300ms `setTimeout` debounce with ref+interval pattern. MutationObserver writes line count to `lineCountRef.current` (no re-render). 500ms `setInterval` syncs ref to state (max 2 re-renders/sec). Prevents React #185 during streaming.
- **CodeBlock.jsx line 160**: Added `max-h-[500px] overflow-y-auto` when expanded (was `overflow-x-auto` only — no vertical scroll).

### Phase 5: StatusBar fixes (bugs 6-7)
- **StatusBar.jsx tok/s (line ~72)**: Removed `chatStreamingText` from useEffect deps. Inside interval callback, reads current value via `useAppStore.getState().chatStreamingText.length`. Interval no longer tears down on every token.
- **StatusBar.jsx GPU (lines 78, 228-232)**: Changed field names from `vramUsed`/`vramTotal`/`gpuName` to `memoryUsed`/`memoryTotal`/`name` to match API response.
- **StatusBar.jsx CPU/RAM**: Added display for CPU usage and RAM. Shows `{ramUsedGB}GB` with tooltip showing full RAM and CPU percentage.
- **server/main.js /api/gpu**: Extended endpoint to include `ramTotalGB`, `ramUsedGB` (from `os.totalmem()/os.freemem()`), and `cpuUsage` (from `os.cpus()` idle ratio).

### Phase 6: agenticLoop.js cleanup
- **Removed**: Phase 2 pre-finalize block (~lines 1211-1231) that set `stream._expectMoreForFile`. No longer needed.
- **Replaced**: T58-Fix-A and R16-Fix-B Phase 2 fence close blocks (`_awaitingMoreContent` checks) with `stream.endFileContent()`.
- **Added**: `stream.endFileContent()` calls at both loop exit points (normal return and max-iterations return).

### Phase 7: Frontend rebuild
- Rebuilt `frontend/dist` with `vite build`. New bundle: `index-CxL8lqbq.js`.
- Picks up: FileContentBlock, store changes, App.jsx events, CodeBlock ref+interval, StatusBar tok/s + GPU + CPU/RAM fixes.

---

## 2026-03-28 — R18 Test + CodeBlock.jsx Fix

### R18 Test Results (world-dashboard.html prompt)
- **Backend pipeline**: Worked correctly. Model generated 762 lines, 27433 chars for world-dashboard.html. Context shift fired at 66%, generation continued. Salvage extracted content from malformed JSON. 2 continuations total.
- **Frontend crash (CRITICAL)**: React error #185 at 300+ lines. The Phase 1 `useEffect` without dependency array caused maximum update depth during streaming. Each streaming token changed children → useEffect fired → setLineCount → re-render → infinite loop.

### CodeBlock.jsx — Replaced useEffect with MutationObserver (lines 73-96)
- **Removed**: `useEffect` without dependency array that called `setLineCount` on every render
- **Added**: `useEffect([], ...)` with `MutationObserver` that watches `codeRef.current` for DOM changes. 300ms debounce on the `setTimeout` prevents rapid state updates during streaming.
- **Root cause**: During streaming, children prop changes identity on every render (React elements from rehype-highlight). `useEffect` without deps runs after every render. Together these caused maximum update depth exceeded (React #185).
- **Frontend rebuilt**: `index-BcsVA3wK.js` replaces `index-C1hrtsjT.js`

---

## 2026-03-28 — R17 Defect Fixes (4 Phases)

### Phase 1: CodeBlock.jsx — Collapse fix + line count display
- **Lines 7, 73-82**: Replaced `typeof children === 'string'` lineCount with DOM-based counting via `useEffect` + `codeRef.current.textContent`. Counts lines from rendered DOM elements — works for both string and React element children (rehype-highlight output).
- **Line 84**: Added `{lineCount > 0 && \`(\${lineCount} lines)\`}` to header next to language label. Code block headers now show "html (245 lines)".
- **Import line 6**: Added `useEffect` to the React import.
- **Root cause**: rehype-highlight converts children to React `<span>` elements, so `typeof children === 'string'` was always false, lineCount was always 0, collapse never triggered.

### Phase 2: StreamHandler + AgenticLoop — Single code block across iterations
- **streamHandler.js constructor (lines 30-32)**: Added `_expectMoreForFile`, `_awaitingMoreContent`, `_awaitBuffer` properties.
- **streamHandler.js onToken()**: Added `_awaitingMoreContent` handling — buffers all tokens between iterations, detects ```json for same file → discards prose, sets `_contentResuming = true`, enters tool hold. If buffer > 1000 chars without tool call → closes fence, flushes prose. If different file → closes old fence, starts fresh.
- **streamHandler.js finalize()**: When `_expectMoreForFile` is set and content was streamed, skips fence close (`\n\`\`\`\n`) and sets `_awaitingMoreContent = true`. Added early return for `_awaitingMoreContent && !isToolCall` (closes fence when model stops without tool call).
- **streamHandler.js reset()**: When `_awaitingMoreContent`, does partial reset preserving fence-open state. Full reset clears `_expectMoreForFile`, `_awaitingMoreContent`, `_awaitBuffer`.
- **streamHandler.js toolCheckpoint()**: Closes any open await fence before sending checkpoint.
- **agenticLoop.js (before stream.finalize)**: Sets `stream._expectMoreForFile = filePath` when: (a) toolCalls contain file writes with streamed content, (b) stopReason !== 'natural' OR salvageUsed OR contextShiftFired, (c) content is structurally incomplete (no </html>, </svg>, etc.).
- **agenticLoop.js R16-Fix-B completion path**: Explicitly closes any open await fence and clears `_expectMoreForFile` when file is complete.
- **agenticLoop.js T58-Fix-A completion path**: Same — closes await fence and clears when salvaged content is structurally complete.
- **Root cause**: `finalize()` always closed the fence, `reset()` cleared all state, next iteration opened a new fence → multiple code blocks. Now fence stays open between iterations for the same file.

### Phase 3: websocket.js — Client-side timeout fix
- **Line ~140**: Changed timeout from `300000` (300s / 5 min) to `1800000` (1800s / 30 min) to match backend `WALL_CLOCK_MS`.
- **Root cause**: Client killed active generation after 5 minutes while backend allows 30 minutes. Multi-iteration file writes routinely exceed 5 minutes.

### Phase 4: Frontend rebuild
- Rebuilt `frontend/dist` with `vite build`. New bundle: `index-C1hrtsjT.js`.
- Picks up: HLJS filter fix (MarkdownRenderer.jsx), CodeBlock collapse fix, line count display, 1800s timeout.
- Verified: HLJS filter present, line count present, 1800s timeout present, 300s timeout absent, textContent-based lineCount present.

---

## 2026-03-28 — Go Live Button Implementation

### server/liveServer.js — New file (220 lines)
- Static file server with WebSocket live-reload
- `start(rootPath)` — starts HTTP server on port 4000+ with WS live-reload on port+1
- `stop()` — stops server and closes WebSocket connections
- `getStatus()` — returns {running, port, wsPort, rootPath, url}
- `notifyReload()` — broadcasts 'reload' to connected WebSocket clients
- Injects live-reload script into HTML files automatically
- MIME type support for common file extensions

### server/main.js — Live server routes
- Line 121: Added `require('./liveServer')` import
- Lines 871-889: Added three routes:
  - `POST /api/live-server/start` — starts server with project path
  - `POST /api/live-server/stop` — stops server
  - `GET /api/live-server/status` — returns current status

### frontend/src/stores/appStore.js — Live server state
- Lines 487-494: Added `liveServerRunning`, `liveServerPort`, `liveServerUrl` state
- Added `setLiveServerStatus(status)` action

### frontend/src/components/StatusBar.jsx — Go Live button
- Line 6: Added `Radio` icon import from lucide-react
- Lines 37-40: Added live server state selectors
- Lines 90-129: Added `toggleLiveServer` async function (start/stop with notifications)
- Lines 260-270: Added Go Live button with Radio icon, green when active, pulse animation

---

## 2026-03-28 — HLJS Label Bug Fix

### MarkdownRenderer.jsx — Filter out 'hljs' utility class from language detection
- Lines 28-30: Replaced simple string split with proper class token filtering
- Now filters out 'hljs' class before extracting language
- Looks for `language-*` token first, falls back to first remaining token
- Fixes bug where code blocks without detected language showed "HLJS" as label

---

## 2026-03-28 — UI Polish: Token Speed, Play Buttons, Labels, Monokai Theme

### StatusBar.jsx — Token speed counter (tok/s)
- Added `useState`, `useRef` imports
- Added `chatStreaming`, `chatStreamingText` store selectors
- Added `tokensPerSec` state and tracking refs (`prevTextLenRef`, `lastTickRef`)
- Added useEffect to calculate tokens/second during streaming (samples every 1s, approximates 4 chars = 1 token)
- Added tok/s display with Zap icon when `tokensPerSec > 0`

### ChatPanel.jsx — Header cleanup
- Lines 207-208: Removed `<span className="font-brand text-[11px] text-vsc-accent">guIDE</span>` — now just says "Chat"
- Lines 212-215: Removed context percentage from header (already shown in footer)

### BottomPanel.jsx — Terminal label cleanup
- Lines 200, 214: Changed `"\x1b[38;2;255;107;0mguIDE Terminal\x1b[0m"` to just `"Terminal"`
- Lines 202, 217: Changed hardcoded orange prompt color to plain `"> "`

### ThemeProvider.jsx — Monokai accent color fix
- Line 139: `input-focus` changed from `'249 38 114'` (pink) to `'166 226 46'` (green)
- Lines 150-155: `accent`, `accent-hover`, `button`, `button-hover`, `peek-border` all changed from pink/magenta to green

### EditorArea.jsx — Play button for HTML tabs
- Added `Play`, `ExternalLink` to imports
- Tab bar now shows play button for HTML/HTM files
- Click opens file content in new browser tab via blob URL

### Sidebar.jsx — Play button in file explorer
- Added `Play` to imports
- FileTreeItem now shows play button on hover for HTML/HTM files
- Added `group` class to enable group-hover animation
- Click fetches file content and opens in new browser tab

---

## 2026-03-28 — UI/UX Fixes + Project Templates

### ChatPanel.jsx — Auto mode default
- Line 52: `useState(true)` changed to `useState(false)` — auto mode now off by default

### StatusBar.jsx — WiFi indicator removal
- Removed `Wifi, WifiOff` from lucide-react import
- Removed `connected` store selector
- Removed entire "Connection status" div block (was showing WiFi/WifiOff icons inappropriate for offline IDE)

### ChatPanel.jsx — Model picker overflow fix
- Outer input container: added `relative` class
- Inner container: `overflow-hidden` changed to `overflow-visible`
- Model picker button wrapper: removed `className="relative"` (was nesting relative containers)
- ModelPickerDropdown render moved outside inner rounded container but inside outer relative container
- Dropdown class: `w-[340px]` changed to `right-0` (full-width relative to parent)

### EditorArea.jsx — Native folder picker
- Inline WelcomeScreen `openFolder()`: now uses `window.electronAPI?.openFolderDialog()` with `prompt()` fallback
- Refactored with `doOpen(path)` helper to avoid code duplication

### WelcomeGuide.jsx — NEW FILE (~300 lines)
- Modal overlay (z-200) with sidebar navigation + content area
- 6 sections: Getting Started, Keyboard Shortcuts, AI & Chat, Editor & Code, Built-in Tools, Tips & Tricks
- "Don't show again on startup" checkbox using localStorage('guIDE-hide-welcome-guide')
- Integrated in App.jsx

### appStore.js — WelcomeGuide state
- Added `showWelcomeGuide`, `setShowWelcomeGuide`, `dismissWelcomeGuideForever` properties

### server/templateHandlers.js — NEW FILE (~600 lines)
- 18 project templates: Blank, React+TS, Next.js, Express, FastAPI, Electron, Static HTML, Chrome Extension, Discord Bot, CLI Tool, Vue 3, SvelteKit, Flask, Docker Compose, Python AI Agent, MCP Server, Tauri App, Rust CLI
- Each template: id, name, description, icon, category, tags, files object
- `{{PROJECT_NAME}}` placeholder replacement in all file contents
- REST endpoints: `GET /api/templates` (metadata), `GET /api/templates/:id` (details), `POST /api/templates/create` (scaffold project)
- Directory existence check, safe name sanitization, recursive mkdir + file write

### server/main.js — Template routes registration
- Added `require('./templateHandlers')` and `registerTemplates(app)` after express.json middleware

### NewProjectDialog.jsx — Full rewrite with template picker
- Replaced simple parent-dir+name dialog with 720px template selection modal
- Category filter tabs: All, Frontend, Backend, Desktop, Tools, AI, General
- 3-column template card grid with icon, name, description, selection highlight
- Browse button for parent directory (Electron native dialog / prompt fallback)
- Preview of sanitized output path
- Create calls `POST /api/templates/create` instead of `POST /api/files/create`

---

## 2026-03-28 — Fix: Server crash on startup (modelDownloader require path)

**Files changed:**
- `server/modelDownloader.js` line 14: `require('./logger')` -> `require(path.join(__dirname, '..', 'logger'))`

**Why:** modelDownloader.js is in `server/` but `logger.js` is at root. Relative `./logger` resolved to `server/logger.js` which doesn't exist. Server crashed silently during module loading. No error was visible because the process just exited.

---

## 2026-03-28 — Wire Frontend Settings to Backend Inference

### frontend/src/components/ChatPanel.jsx — Send all settings in invoke params
- The invoke('ai-chat') call now sends ALL 16 sampling/behavior settings from appStore.settings
- Added to params: temperature, maxTokens, topP, topK, repeatPenalty, seed, thinkingBudget, reasoningEffort, maxIterations, generationTimeoutSec, snapshotMaxChars, enableThinkingFilter, enableGrammar, systemPrompt, customInstructions, gpuPreference, gpuLayers, contextSize
- Also sends cloudProvider and cloudModel at the top level of context

### agenticChat.js — Read settings from context.params
- MAX_AGENTIC_ITERATIONS now reads context.params.maxIterations first (was only reading context.maxIterations)
- Custom instructions: if context.params.customInstructions is set, appends it to the user message as [User Instructions: ...]
- Both cloud and local paths now receive the effectiveMessage (with custom instructions appended)

### pipeline/agenticLoop.js — Use frontend settings for inference
- Sampling params fallbacks now match frontend defaults: temperature 0.4 (was 0.5), topP 0.95 (was 0.9), topK 40 (was 20), repeatPenalty 1.1 (was 1.15)
- System prompt: if context.params.systemPrompt is non-empty, uses it as basePreamble (overrides DEFAULT_COMPACT_PREAMBLE)
- Thinking budget: sets llmEngine.thoughtTokenBudget from context.params.thinkingBudget
- Generation timeout: sets llmEngine.generationTimeoutMs from context.params.generationTimeoutSec * 1000

---

## 2026-03-28 — Advanced Settings, Persistence, Folder Picker, Context Menu

### frontend/src/stores/appStore.js — Settings state expansion + localStorage persistence
- Expanded settings object from 7 properties to 28 properties matching old IDE's AdvancedSettingsPanel
- Added: systemPrompt, customInstructions, contextSize, repeatPenalty, seed, thinkingBudget, reasoningEffort, generationTimeoutSec, snapshotMaxChars, enableThinkingFilter, enableGrammar, gpuPreference, requireMinContextForGpu, fontSize, fontFamily, tabSize, wordWrap, lineNumbers, bracketPairColorization, formatOnPaste, formatOnType
- Settings now load from localStorage('guIDE-settings') on store creation with IIFE
- Every updateSetting() call auto-saves to localStorage
- Added resetSettings() to restore all defaults and clear localStorage
- Defaults match old IDE: temperature 0.4, topP 0.95, maxIterations 25, repeatPenalty 1.1, etc.

### frontend/src/components/Sidebar.jsx — SettingsPanel full rewrite (~350 lines)
- Replaced flat settings panel with collapsible section architecture (SettingsSection component)
- 9 collapsible sections: Theme, LLM/Inference, Thinking & Reasoning, Agentic Behavior, System Prompt, Hardware, Editor, AI Model, then existing Tool Toggles/MCP/Keyboard Shortcuts
- LLM/Inference: temperature slider, maxResponseTokens, contextSize (with "requires reload" warning), topP, topK, repeatPenalty, seed
- Thinking & Reasoning: 3-button reasoningEffort (Low/Med/High with icons), thinkingBudget with slider + number input + infinity toggle, Auto/Unlimited display
- Agentic Behavior: maxIterations, generationTimeout, snapshotMaxChars, enableThinkingFilter toggle, enableGrammar toggle
- System Prompt: large textarea for system prompt override with Clear button, customInstructions textarea
- Hardware: GPU mode (Auto/CPU buttons), gpuLayers number field, requireMinContextForGpu toggle
- Editor: fontSize slider, fontFamily text input, tabSize slider, wordWrap select, lineNumbers select, minimap/bracketPairColorization/formatOnPaste/formatOnType toggles
- Header now has Reset button (RotateCcw icon)
- New helper components: SettingsSection (collapsible), SettingToggle (boolean switch), SettingNumberField (label + number input)
- Added imports: Save, RotateCcw, Zap, Scale, Brain, Cpu, Monitor, Type, FolderOpen, ExternalLink

### frontend/src/components/Sidebar.jsx — File context menu enhancements
- Added "Copy Relative Path" menu item (computes path relative to projectPath)
- Added "Reveal in File Explorer" menu item (only shows when Electron API available, uses shell.showItemInFolder)
- Added handleCopyRelativePath and handleRevealInExplorer handlers in FileTreeItem
- Updated FileContextMenu component signature with new props

### frontend/src/components/Sidebar.jsx — Native folder picker
- FileExplorer.openFolder now uses window.electronAPI.openFolderDialog() (native Electron dialog)
- Falls back to prompt() when running in browser (dev mode without Electron)

### electron-main.js — 2 new IPC handlers
- 'dialog-open-folder': opens native folder picker dialog via dialog.showOpenDialog(), returns selected path or null
- 'shell-show-item': reveals file/folder in OS file explorer via shell.showItemInFolder()
- Added dialog to electron imports

### preload.js — 2 new API methods
- openFolderDialog(): invokes 'dialog-open-folder' IPC
- showItemInFolder(fullPath): invokes 'shell-show-item' IPC

---

## 2026-03-28 — Chat Panel Improvements (Header, Code Blocks, Model Picker)

### frontend/src/components/ChatPanel.jsx — Header buttons
- Added Plus (new chat) and Settings buttons to chat header alongside Trash
- Plus calls handleClear(); Settings calls setActiveActivity('settings')
- Imported Settings, Cloud, Key, FolderPlus, Sparkles, Eye, ImageIcon from lucide-react
- Added cloudProvider to main ChatPanel component from store
- Model display name now shows cloud provider name when using cloud, local model name otherwise
- Model picker toolbar button shows Cloud icon (blue) when cloud provider active, Cpu icon when local

### frontend/src/components/ChatPanel.jsx — ModelPickerDropdown full rewrite (~500 lines)
- Replaced 165-line stub with full port of old IDE's ModelPicker.tsx
- PROVIDER_INFO: 22 providers with signupUrl, free flag, placeholder, note
- VISION_MODEL_SUBSTRINGS + isVisionModel(): vision capability detection per provider
- Favorites section: cloud (cloud:provider:model keys) + local model favorites at top
- "guIDE Cloud AI" bundled entry: auto-routes to fastest free provider
- "Add Your Own Key — Free" collapsible section: 11 free providers, each expandable
- "Premium Providers" collapsible section: 11 paid providers
- Per-provider: inline API key input with Save, "Get free API key" signup link, notes, model list with vision badges, "Test key" button, "Disconnect" button
- OpenRouter special: live catalog via /api/cloud/models/openrouter, search, free/paid sections, per-model vision badge + favorite toggle
- "Quick Add" recommended models section: VRAM detection, download progress bars, category badges (coding/reasoning/general), "Other models" for exceeding VRAM
- Local models section: name/size/quant/params, star toggle, checkmark for active
- Image models section: only visible when diffusion models present
- "Add Model Files..." and "Rescan models" buttons
- New ProviderModelList sub-component: fetches /api/cloud/models/:provider, renders model list with vision badges and favorites

### frontend/src/components/chat/CodeBlock.jsx — Collapse by default
- Added collapsed state (default: true) and COLLAPSE_LINE_THRESHOLD = 10
- Blocks with >10 lines show first ~10 lines when collapsed with gradient fade overlay
- "Show more (N lines)" button at bottom when collapsed
- "Show less" button when expanded
- Imported ChevronDown, ChevronRight from lucide-react

### frontend/src/stores/appStore.js — Cloud provider state
- Added cloudProvider, cloudModel, setCloudProvider, setCloudModel

### server/main.js — 2 new endpoints
- GET /api/cloud/test/:provider — tests API key by making minimal generate call (5 tokens)
- GET /api/models/recommend — detects GPU VRAM via nvidia-smi, returns curated recommended models list (7 Qwen 3 models) split into fits/other based on VRAM

---

## 2026-03-28 — Menu Bar (Functional Dropdowns)

### frontend/src/components/TitleBar.jsx (rewritten — ~360 lines)
- Replaced 8 non-functional `MenuButton` stubs with dropdown menu system
- 7 menus: File, Edit, Selection, View, Go, Terminal, Help
- Each menu has items with labels, keyboard shortcut hints, and wired actions
- File: New File, Open Folder, Save, Close Editor, Close All, Exit
- Edit: Undo, Redo, Cut, Copy, Paste, Find, Replace, Find in Files
- Selection: Select All, Expand/Shrink Selection
- View: Command Palette, Explorer/Search/Git/Chat panel toggles, Sidebar/Panel toggles, Minimap, Word Wrap, Zoom
- Go: Go to File, Go to Line
- Terminal: New Terminal, Toggle Terminal
- Help: Welcome, Keyboard Shortcuts, About
- Hover-to-switch between open menus (VS Code behavior)
- Click outside or Escape to close
- Actions wired to appStore functions and native browser commands
- Removed old `MenuButton` component

---

## 2026-03-28 — Git Operations (Stage, Commit, Diff, Branch, Log, Discard)

### server/main.js — 8 new endpoints
- `POST /api/git/stage` — stage files (files array or all:true)
- `POST /api/git/unstage` — unstage files (files array or all:true)
- `POST /api/git/commit` — commit with message
- `POST /api/git/discard` — discard working directory changes (git checkout --)
- `GET /api/git/diff` — get diff (query: file, staged)
- `GET /api/git/log` — commit history (format: hash|message|author|date)
- `GET /api/git/branches` — list branches with current marker
- `POST /api/git/checkout` — switch or create branch

### frontend/src/components/Sidebar.jsx — GitPanel rewrite (~250 lines)
- Replaced read-only GitPanel with full-featured version
- Commit message textarea with Ctrl+Enter shortcut
- Stage/unstage per-file (+/-) and "Stage All" buttons
- Discard changes per-file with confirmation dialog
- Branch bar with change count badge
- Branch picker: list, switch, create new branch inline
- Commit history panel (toggle with History icon)
- Click file name to open diff in editor
- GitFileSection: hover-reveal action buttons (stage/unstage/discard), click-to-diff
- Added lucide icons: Check, Minus, Undo2, History, GitMerge

---

## 2026-03-28 — Shared File Icons (FileIcon.jsx)

### frontend/src/components/FileIcon.jsx (NEW — ~130 lines)
- Shared component with ICON_MAP (45+ extensions), EXTENSION_ALIASES (30+ aliases)
- Special filename detection (Dockerfile, Makefile, docker-compose)
- Props: extension, name, isDirectory, isOpen, size
- Directory support via Folder/FolderOpen icons

### frontend/src/components/Sidebar.jsx
- Added `import FileIcon from './FileIcon'`
- Replaced inline icon logic in FileNode with `<FileIcon>` component
- Removed old inline `function FileIcon({ extension })` (lines 333-398, ~65 lines)
- Removed unused icon imports: File, FileText, FileJson, FileType, FileCog, Folder, FolderOpen

### frontend/src/components/EditorArea.jsx
- Added `import FileIcon from './FileIcon'`
- Replaced `<TabFileIcon extension={tab.extension} />` with `<FileIcon extension={tab.extension} size={14} />`
- Removed `function TabFileIcon` (~30 lines)
- Removed unused icon imports: File, FileCode, FileJson, FileType, FileCog

---

## 2026-03-28 — Editor Previews (HTML, Markdown, JSON, CSV, SVG, Image)

### frontend/src/components/EditorPreviews.jsx (NEW — ~380 lines)
- 7 preview components ported from old IDE's `Previews.tsx` (TSX to JSX):
  - `HtmlPreview` — live iframe with auto-refresh on content change, `<base>` tag for relative paths, refresh + open-in-browser buttons
  - `MarkdownPreview` — regex-based MD→HTML conversion (headings, bold, italic, code blocks, lists, links, images, blockquotes, HR, tables), dark theme CSS, iframe sandboxed
  - `JsonPreview` — collapsible tree view with color-coded types (null=blue, number=green, string=orange, key=sky), "Expand All" button
  - `CsvPreview` — sortable table with headers, TSV support, click-to-sort columns, row numbers
  - `SvgPreview` — zoom controls (25%-400%), background color picker (dark/white/gray/checkerboard), script tag sanitization
  - `ImagePreview` — `file:///` src display with error fallback
  - `BinaryPreview` — informational display for unsupported binary files
- Shared `PreviewToolbar` sub-component for consistent header bar across all preview types
- Helper exports: `isPreviewable(filePath)` and `getPreviewType(filePath)` for extension-based detection
- Supported extensions: html, htm, md, markdown, json, csv, tsv, svg, png, jpg, jpeg, gif, webp, bmp, ico

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Imported preview components + `Eye`, `Code2` icons
- Added `previewMode` state — `{ [tabId]: boolean }` per-tab preview toggle
- Added "Preview" / "Code" toggle button in breadcrumb bar (only shown for previewable files)
- Added preview routing: when `previewMode[tabId]` is true, renders the appropriate preview component instead of Monaco editor
- Preview components receive `onToggleCode` callback to switch back to Monaco

## 2026-03-28 — Cloud Provider Settings UI

### frontend/src/components/Sidebar.jsx (MODIFIED)
- Added `CloudProviderSettings` sub-component (~170 lines) inside Sidebar.jsx, before SettingsPanel
- Fetches provider list from `GET /api/cloud/providers` and status from `GET /api/cloud/status` on mount
- Provider dropdown with all 26 providers, free-tier badges (green, "no API key needed")
- API key input (password type) with Save button for paid providers → `POST /api/cloud/apikey`
- Model picker dropdown — fetches from `GET /api/cloud/models/:provider`, falls back to text input for providers without catalogs
- "Set as Active Provider" button → `POST /api/cloud/provider`
- Active provider status banner (green) with "Switch to local model" deactivation link
- Collapsible section (collapsed by default) inserted between Inference and Model Selection sections
- No server changes — all 6 `/api/cloud/*` endpoints already existed

## 2026-03-28 — HuggingFace Model Download System

### server/modelDownloader.js (NEW — ~260 lines)
- `ModelDownloader` class (extends EventEmitter) — search HuggingFace + download GGUF models
- `searchModels(query)` — hits `https://huggingface.co/api/models?filter=gguf&sort=downloads` with user query
- `getRepoFiles(repoId)` — fetches repo info, filters siblings for `.gguf` files, extracts quantization level, sorts by quant priority
- `downloadModel(url, fileName)` — streams GGUF file to `models/` dir with `.downloading` temp extension, follows redirects (up to 5), emits progress every 500ms
- Progress events: `download-started`, `download-progress` (percent, speed, ETA), `download-complete`, `download-error`, `download-cancelled`
- `cancelDownload(id)` — aborts active download, cleans up temp file
- Helpers: `_formatSize()`, `_formatEta()`, `_extractQuant()` (regex for Q4_K_M etc), `_quantPriority()` (sorting Q2 through F32)

### server/main.js (MODIFIED)
- Added `require('./modelDownloader')` import, instantiated `new ModelDownloader(path.join(ROOT_DIR, 'models'))`
- 5 new REST endpoints:
  - `GET /api/models/hf/search?q=` — search HuggingFace for GGUF models
  - `GET /api/models/hf/files/:owner/:repo` — list GGUF files in a HF repo with quant info
  - `POST /api/models/hf/download` — start downloading `{url, fileName}`, returns download ID
  - `POST /api/models/hf/cancel` — cancel download `{id}`
  - `GET /api/models/hf/downloads` — list active downloads
- Wired all 5 download events to `mainWindow.webContents.send()` for WebSocket broadcast
- Auto-rescans models (`modelManager.scanModels()`) when a download completes

### frontend/src/components/ModelDownloadPanel.jsx (NEW — ~280 lines)
- Full download UI component: search bar with 500ms debounce, results list, repo file picker
- Search results: model name, author, download count, likes, chevron to browse files
- File picker: shows all GGUF quantization variants (Q4_K_M, Q8_0, etc), size, download button
- `DownloadProgressBar` sub-component: progress bar, percent, speed, ETA, cancel button
- Active downloads section at bottom of both views
- Uses store state (`modelDownloads`) routed via App.jsx event handler

### frontend/src/components/WelcomeScreen.jsx (MODIFIED)
- Added `ModelDownloadPanel` import and `Download` icon import
- Added `showDownloadPanel` state — toggles full-screen download overlay
- "Installed Models" header: added "Download more" link (triggers download panel)
- "No models found" section: added "Download from HuggingFace" button (triggers download panel)

### frontend/src/stores/appStore.js (MODIFIED)
- Added `modelDownloads: {}` state (id → download data with status)
- Added `updateModelDownload(id, data)` — merges download progress into store
- Added `removeModelDownload(id)` — removes completed/cancelled download

### frontend/src/App.jsx (MODIFIED)
- Added 5 download event handlers in `handleEvent` switch:
  - `download-started` → `updateModelDownload(id, { status: 'downloading', percent: 0 })`
  - `download-progress` → `updateModelDownload(id, { status: 'downloading' })`
  - `download-complete` → `updateModelDownload` + notification
  - `download-error` → `updateModelDownload` + error notification
  - `download-cancelled` → `removeModelDownload(id)`

---

## 2026-03-28 — Account/OAuth Sidebar Panel

### frontend/src/components/AccountPanel.jsx (NEW — ~290 lines)
- Full port of `C:\Users\brend\IDE\src\components\Account\AccountPanel.tsx` (TSX to JSX)
- Three states: activated (license active), authenticated (free plan), sign-in form
- OAuth buttons: Google (SVG icon), GitHub (lucide icon) — calls POST /api/license/oauth
- Tab switcher: Email/password sign-in vs License Key activation — calls POST /api/license/activate
- Activated state: user avatar, plan info, license key display, Manage Account link, Sign Out button
- Free user state: Upgrade to Pro card ($4.99/mo), local AI included, Sign Out
- Sign-in state: UserCircle header, OAuth buttons, email/password form, license key form, register link
- Uses REST API calls instead of old `window.electronAPI.license*` IPC calls
- Uses `window.electronAPI?.openExternal` with `window.open` fallback for external links

### frontend/src/components/ActivityBar.jsx (MODIFIED)
- Added `UserCircle` import from lucide-react
- Added Account button in bottom section (between AI Chat and Settings) — activates 'account' sidebar view

### frontend/src/components/Sidebar.jsx (MODIFIED)
- Added `import AccountPanel from './AccountPanel'`
- Added `case 'account': return <AccountPanel />;` to activeActivity switch

### server/main.js (MODIFIED)
- Added 4 license REST endpoints after cloud endpoints:
  - `GET /api/license/status` — returns isActivated, isAuthenticated, license data, machineId from licenseManager stub
  - `POST /api/license/activate` — accepts `{method: 'key', key}` or `{method: 'account', email, password}` — returns stub error ("License server not yet connected")
  - `POST /api/license/oauth` — accepts `{provider: 'google'|'github'}` — returns stub error ("OAuth not yet available")
  - `POST /api/license/deactivate` — resets in-memory license state, returns success
- All endpoints are stubs ready for real licenseManager.js port later

---

## 2026-03-28 — Cloud LLM Service Port (26 Providers)

### cloudLLMService.js (NEW — 1000+ lines)
- Full port of `C:\Users\brend\IDE\main\cloudLLMService.js` to guide-2.0
- 26 cloud providers: OpenAI, Anthropic, Google, xAI, OpenRouter, Cerebras, SambaNova, Groq, Together, Fireworks, NVIDIA, Cohere, Mistral, HuggingFace, Cloudflare, Perplexity, DeepSeek, AI21, DeepInfra, Hyperbolic, Novita, Moonshot, Upstage, Lepton, APIFreeLLM, GraySoft
- Plus local Ollama support (auto-detection, NDJSON streaming)
- Bundled free-tier keys: Groq (7 pool keys), Cerebras (21 pool keys), SambaNova, Google, OpenRouter — XOR 0x5A obfuscated
- Key pool round-robin with per-key cooldown on 429
- Rate limiting: sliding-window RPM pacer at 85% capacity, adaptive 429 backoff, header-based RPM learning
- Fallback chain: sambanova → cerebras → google → nvidia → cohere → mistral → huggingface → cloudflare → together → fireworks → openrouter → groq
- Anthropic special handler (different message format, `x-api-key` header, thinking_delta support)
- OpenRouter live model catalog (fetched + cached 10min, NSFW/ERP models blocked)
- Proxy routing via graysoft.dev when session token available + bundled provider
- Context trimming: auto-drops oldest messages to fit model context limit
- Stream timeouts: 20s first-data, 10s idle, with graceful partial-result recovery
- Exports: `CloudLLMService`, `PROVIDER_MODELS`, `PROVIDER_LABELS`, `BUNDLED_PROVIDERS`

### server/main.js (MODIFIED)
- Added `require('../cloudLLMService')` import at line ~112
- Instantiated `const cloudLLM = new CloudLLMService()` after other pipeline components (~line 128)
- Replaced `cloudLLM` stub (was: `{ getStatus: () => ({ providers: [] }), ... }`) with real CloudLLMService instance in ctx object
- Wired `cloudLLM.setLicenseManager(ctx.licenseManager)` before agenticChat.register()
- Added 6 new REST API endpoints:
  - `GET /api/cloud/status` — returns hasKeys, providers, activeProvider, activeModel
  - `GET /api/cloud/providers` — returns configured + all providers (with hasKey, isFree flags)
  - `GET /api/cloud/models/:provider` — returns model catalog (live fetch for OpenRouter, Ollama detect)
  - `POST /api/cloud/provider` — set active provider + model
  - `POST /api/cloud/apikey` — set API key for a provider
  - `GET /api/cloud/pool/:provider` — returns pool status (total, available, onCooldown)

### frontend/src/components/StatusBar.jsx (MODIFIED)
- Added `tokenStats` and `gpuMemory` reads from appStore
- Added `useEffect` polling `/api/gpu` every 10s when model is loaded → updates `gpuMemory` state
- Added token stats display: Zap icon + formatted token count (K/M suffixes), tooltip shows session tokens + request count
- Added GPU memory display: HardDrive icon + `{vramUsed}MB`, tooltip shows used/total + GPU name
- Both items appear in the right section before the context usage ring
- Added `_formatTokens()` helper (1K, 1.5M format)
- Imported `Zap`, `HardDrive` from lucide-react, `useEffect` from react

---

## 2026-03-28 — TDZ Fix, CI/CD Setup, Cross-Platform Builds

### frontend/src/components/ThemeProvider.jsx (MODIFIED)
- **Root bug fixed**: `useEffect` at lines ~608-614 had `[setTheme]` in its dependency array, but `const setTheme = useCallback(...)` was declared AFTER the useEffect in the same function body. This created a temporal dead zone (TDZ) that crashed the app on every load with `ReferenceError: Cannot access 'i' before initialization` at minified bundle column 61238.
- Fix: moved `const setTheme = useCallback(...)` declaration to BEFORE the `useEffect` that depends on it. Zero semantic change — only declaration order.
- This was the ONLY runtime crash preventing the app from rendering. ErrorBoundary caught it and showed "Try to Recover / Reload Page".

### frontend/dist/ (REBUILT)
- Vite rebuild after ThemeProvider fix — new bundle hash `index-DOa53em2.js` (was `index-iW266mLD.js`).

### package.json (MODIFIED)
- Added `build:renderer` script (alias for `frontend:build`) — required by GitHub Actions workflow
- Added `release:patch`, `release:minor`, `release:major` scripts — `npm version X && git push && git push --tags`
- To deploy a new version: `npm run release:patch` bumps 2.0.0 → 2.0.1, creates tag v2.0.1, triggers CI build

### electron-builder.nosign.json (MODIFIED)
- Added `mac` section: DMG target for x64 + arm64, icon `build/icon.icns`, artifact `guIDE-${version}-cpu-mac-${arch}.dmg`
- Added `linux` section: AppImage target for x64, icon `build/icon.png`, artifact `guIDE-${version}-cpu-linux-x64.AppImage`

### electron-builder.nosign.cuda.json (MODIFIED)
- Added `mac` section: DMG target for x64 + arm64, icon `build/icon.icns`, artifact `guIDE-${version}-cuda-mac-${arch}.dmg`
- Added `linux` section: AppImage target for x64, icon `build/icon.png`, artifact `guIDE-${version}-cuda-linux-x64.AppImage`

### .github/workflows/build.yml (NEW)
- 5 jobs: build-windows-cpu, build-windows-cuda, build-linux-cpu, build-linux-cuda, build-mac
- Triggered by push to `v*` tags OR `workflow_dispatch`
- Each job: `npm ci --ignore-scripts` (root) + `npm ci` (frontend) + `npm run build:renderer` + `npx electron-builder`
- Windows: uses `CSC_IDENTITY_AUTO_DISCOVERY: false` (no code signing)
- Linux: converts `build/icon.ico` to `build/icon.png` via ImageMagick
- macOS: builds full `.icns` from `.ico` using `sips` + `iconutil`, x64 + arm64 universal
- `release` job: runs after all 5 builds succeed, creates GitHub Release with all artifacts
- **To release**: `npm run release:patch` from local machine → CI builds everything automatically

---

## 2026-03-27 — FG7: Model Favorites, Activity Bar Stubs, Keyboard Shortcuts, Files Changed Bar, Streaming Code Block, Cloud Providers, Image Attachments, App Icon

### frontend/src/stores/appStore.js (MODIFIED)
- Added `favoriteModels` (localStorage persisted array) + `toggleFavoriteModel` action
- Added `chatFilesChanged: []` + `setChatFilesChanged` + `addChatFileChanged` (merge-on-duplicate by path)
- Added `chatAttachments: []` + `addChatAttachment` + `removeChatAttachment` + `clearChatAttachments`
- `clearChat` now also resets `chatFilesChanged`

### frontend/src/components/ChatPanel.jsx (MODIFIED)
- ModelPickerDropdown: `Star` icon toggle per model (yellow filled when favorited), favorites sorted to top
- ModelPickerDropdown: "Cloud AI" section at bottom with OpenAI/Anthropic/Google Gemini showing "Coming soon"
- Files changed bar: scrollable row of file pills with +N/-N line counts above textarea
- Image/file attachments: hidden file input wired to Paperclip button, `onPaste` handler for clipboard images
- Attachment previews: image thumbnails (12x12) or file name pills with remove X button on hover
- `streaming` prop passed to MarkdownRenderer for streaming messages

### frontend/src/components/Sidebar.jsx (MODIFIED)
- Added `DebugPanel` stub component (coming soon placeholder for debug activity bar item)
- Added `ExtensionsPanel` stub component (coming soon placeholder for extensions activity bar item)
- Switch statement now handles 'debug' and 'extensions' cases

### frontend/src/App.jsx (MODIFIED)
- Added `Ctrl+L` keyboard shortcut: toggles AI chat panel
- Added `Ctrl+N` keyboard shortcut: opens new project dialog

### frontend/src/components/chat/MarkdownRenderer.jsx (MODIFIED)
- Added `streaming` prop: when true, auto-closes unclosed code fences (counts ``` markers, appends trailing ``` if odd)

### frontend/src/components/TitleBar.jsx (MODIFIED)
- Added real app icon (`zzz.ico`) as `<img>` next to guIDE brand text in title bar

### frontend/index.html (MODIFIED)
- Added `<link rel="icon" type="image/x-icon" href="/favicon.ico" />` for browser favicon

### frontend/public/favicon.ico (NEW — copied from IDE/zzz.ico)
- Real guIDE app icon (76KB .ico) used as browser favicon

### frontend/public/icon.ico (NEW — copied from IDE/zzz.ico)
- Real guIDE app icon used for title bar `<img>` reference

### src-tauri/icons/icon.ico (REPLACED)
- Replaced default Tauri icon (214 bytes) with real zzz.ico (76KB)

---

## 2026-03-29 — FG8: Files Changed Polish, Drag-Drop, Message Queue, Checkpoints, Virtuoso, Fence Fix, Explorer DnD, Diff Viewer, Inline Chat, MCP Config

### frontend/src/stores/appStore.js (MODIFIED)
- Added `messageQueue: []` + `addQueuedMessage` + `removeQueuedMessage` + `updateQueuedMessage` + `clearMessageQueue`
- Added `diffState: null` + `openDiff(original, modified, title)` + `closeDiff()`
- Added `mcpServers` (localStorage persisted) + `addMcpServer` + `removeMcpServer` + `toggleMcpServer`
- `clearChat` now also resets `messageQueue`

### frontend/src/components/ChatPanel.jsx (MODIFIED)
- Files changed bar: expand/collapse toggle (ChevronRight/Down), Keep All + Undo All buttons, per-file Keep/Undo
- Collapsed mode shows pill bar, expanded mode shows vertical list
- Textarea drag-and-drop: handleDragOver/handleDragLeave/handleDrop, visual ring indicator for dragOver
- Message queue: numbered editable items with remove button above textarea
- Checkpoint dividers: between assistant->user transitions, RotateCcw + Clock + timestamp, restore button (stub)
- Replaced manual scroll div with `<Virtuoso>` from react-virtuoso — followOutput="smooth", Header (warnings/todos), Footer (streaming), itemContent (messages)
- Removed messagesEndRef, scrollToBottom callback, manual scroll useEffect

### frontend/src/components/chat/MarkdownRenderer.jsx (MODIFIED)
- Fence parsing: tracks openFenceLen (length of opening backticks), iterates line-by-line, only counts closing fences with >= backticks as opener
- Properly handles inner backticks without prematurely closing fences

### frontend/src/components/Sidebar.jsx (MODIFIED)
- FileTreeItem: drag-and-drop support — draggable, onDragStart/onDragOver/onDragLeave/onDrop, calls /api/files/rename to move files
- Visual indicator: ring-1 ring-vsc-accent/40 on dragOver for directories
- Added MCPConfigPanel to SettingsPanel: server list with enable/disable toggle, add form (name/command/args), remove button
- Imported Server, Power icons from lucide-react

### frontend/src/components/DiffViewer.jsx (NEW)
- Monaco DiffEditor wrapper — reads diffState from store
- Toggle between inline/side-by-side (Columns/Rows icons), close button calls closeDiff()
- Read-only, vs-dark theme, no minimap

### frontend/src/components/InlineChat.jsx (NEW)
- Floating chat input at editor cursor position, triggered by Ctrl+I
- Text input + submit (ArrowUp) + close (X) buttons
- Escape key closes, Enter submits
- Sparkles icon, glass-strong styling

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Imports DiffViewer and InlineChat
- Conditional render: diffState ? DiffViewer : activeTab ? Editor : null
- Ctrl+I handler: reads cursor position + selection from Monaco, opens InlineChat at cursor coordinates
- InlineChat onSubmit: sends selected code + prompt as user message via addChatMessage

### frontend/package.json (MODIFIED)
- Added react-virtuoso dependency

---

## 2026-03-28 — FG6: Remaining Checklist Items (TodoDropdown, Line Numbers, StatusBar Interactive, Selection Badge, Welcome Screen, New Project Dialog, Math, Mermaid)

### frontend/src/stores/appStore.js (MODIFIED)
- Added `editorEol: 'LF'` + `setEditorEol`
- Added `editorEncoding: 'UTF-8'` + `setEditorEncoding`
- Added `editorIndentSize: 2` + `setEditorIndentSize`
- Added `editorIndentType: 'spaces'` + `setEditorIndentType`
- Added `editorSelection: null` + `setEditorSelection` (tracks { chars, lines } or null)
- Added `showNewProjectDialog: false` + `setShowNewProjectDialog`

### frontend/src/components/StatusBar.jsx (MODIFIED)
- All editor status items (Ln/Col, Spaces, Encoding, EOL, Language) converted from `<div>` to `<button>` with click handlers
- Spaces: click cycles Spaces: 2 -> Spaces: 4 -> Tabs -> Spaces: 2
- Encoding: click cycles UTF-8 -> UTF-16LE -> UTF-8
- EOL: click toggles LF <-> CRLF
- Language: click opens command palette
- Ln/Col: now shows selection count when text is selected (e.g., "Ln 5, Col 3 (42 selected)")
- Added store reads for editorEol, editorEncoding, editorIndentSize, editorIndentType, editorSelection, openCommandPalette

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Monaco options: tabSize reads from `editorIndentSize`, insertSpaces reads from `editorIndentType === 'spaces'`
- Added `onDidChangeCursorSelection` listener: tracks selection chars + lines, clears on empty selection
- WelcomeScreen: enhanced layout — 2-column grid with Start section + Keyboard Shortcuts section, added Command Palette action, more shortcuts (Ctrl+L, Ctrl+P, Ctrl+/, Ctrl+\`), kbd styling, footer tag

### frontend/src/components/ChatPanel.jsx (MODIFIED)
- Added `editorSelection` from store
- Context indicator now shows selected text badge alongside file name badge (shows chars + lines count, warning-colored)

### frontend/src/components/chat/CodeBlock.jsx (MODIFIED — prior session)
- Added `Hash` icon import from lucide-react
- Added line numbers toggle button in toolbar (uses existing `showLineNumbers` state, accent color when active)

### frontend/src/components/chat/MarkdownRenderer.jsx (MODIFIED)
- Added imports: `remarkMath`, `rehypeKatex`, `MermaidBlock`, `katex/dist/katex.min.css`
- remarkPlugins: added `remarkMath` for parsing $...$ and $$...$$ math syntax
- rehypePlugins: added `rehypeKatex` for rendering math to KaTeX HTML
- Code block handler: routes `language-mermaid` blocks to MermaidBlock instead of CodeBlock

### frontend/src/components/chat/MermaidBlock.jsx (NEW)
- Renders mermaid diagram code into SVG using mermaid library
- Dark theme with custom colors matching app theme
- Error state: shows error message in red-bordered box
- Loading state: "Rendering diagram..." placeholder
- Uses dangerouslySetInnerHTML for the SVG (mermaid's render output)

### frontend/src/components/NewProjectDialog.jsx (NEW)
- Modal dialog for creating a new project folder
- Fields: Parent Directory (text input), Project Name (text input)
- Shows computed full path preview
- Calls /api/files/create with isDirectory: true, opens project on success
- Cancel/Create buttons, keyboard support (Enter to create, click outside to close)

### frontend/src/App.jsx (MODIFIED)
- Added import for NewProjectDialog
- Renders NewProjectDialog as sibling to Layout inside ThemeProvider

### frontend/src/index.css (MODIFIED)
- Added `.kbd` class: styled keyboard key for welcome screen shortcuts

### frontend/package.json (MODIFIED)
- Added dependencies: `remark-math@^6.0.0`, `rehype-katex@^7.0.1`, `katex`, `mermaid`

---

## 2026-03-28 — Monaco Polish, Model Picker, Git Status, CodeBlock Download (Feature Group 5)

### frontend/src/stores/appStore.js (MODIFIED)
- Added `minimapEnabled: true` to settings object (toggleable from settings panel)
- Added `editorDiagnostics: { errors: 0, warnings: 0 }` and `setEditorDiagnostics(d)` action
- Added `gitBranch: 'main'` and `setGitBranch(b)` action for dynamic branch name
- Added `gitFileStatuses: {}` and `setGitFileStatuses(statuses)` — map of relativePath to status char (M/A/?)

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Added `setEditorDiagnostics` from store and `minimapEnabled` from settings
- Monaco `onMount` now receives `(editor, monaco)` — added `monaco.editor.onDidChangeMarkers` to track error/warning counts from Monaco's diagnostics system
- Minimap `enabled` now reads from `minimapEnabled` setting instead of hardcoded `true`

### frontend/src/components/StatusBar.jsx (MODIFIED)
- Added `diagnostics` and `gitBranch` from store
- Branch display: replaced hardcoded "main" with dynamic `{gitBranch}`
- Errors/warnings: replaced hardcoded "0" with `{diagnostics.errors}` and `{diagnostics.warnings}`, colored red/yellow when > 0

### frontend/src/components/ChatPanel.jsx (MODIFIED)
- **ModelPickerDropdown** rewritten:
  - Added search/filter input (autoFocus) that filters by model name or family
  - Added model loading status indicator (spinner + progress percentage)
  - Current model section: shows name, family, context size, green dot indicator, unload button
  - Available models: show family and size info, disabled when loading or current
  - No matching models / no models empty states
  - Width increased to 300px, max height 400px
- **System messages**: new rendering path for `role === 'system'` — italic, dimmed, left border accent, no bubble
- **Context indicator**: shows current file name badge above textarea when a file is open (accent-colored pill with FileCode icon)
- Added `activeTabId` and `openTabs` from store for context indicator

### frontend/src/components/chat/CodeBlock.jsx (MODIFIED)
- Added `Download` icon import from lucide-react
- Added `handleDownload` function: creates Blob from code content, generates download link with language-appropriate extension (e.g., .js, .py, .html), triggers download via temporary anchor element
- Added Download button to toolbar between word wrap and apply-to-file buttons

### frontend/src/components/Sidebar.jsx (MODIFIED)
- **FileExplorer**: Added `setGitBranch` and `setGitFileStatuses` from store, added `fetchGitStatus()` callback that calls `/api/git/status`, parses results into flat map, updates branch name and file statuses. Called on refresh.
- **FileTreeItem**: Added `gitFileStatuses` from store, computes relative path for git status lookup, displays: file name color-coded (yellow for modified, green for staged/untracked), status character badge (M/A/?) aligned right with matching color

### frontend/tailwind.config.js (MODIFIED)
- Added `scale-in` animation: `scaleIn 0.15s ease-out` (0% → scale 0.95 + opacity 0, 100% → scale 1 + opacity 1)
- Useful for dropdown/popover entrance animations

---

## 2026-03-28 — UI Theme System & Input Area Overhaul

### frontend/src/components/ThemeProvider.jsx (NEW)
- Created complete theme system with 10 themes: Monolith (default), Dark Default, Monokai, Dracula, Nord, Solarized Dark, GitHub Dark, Void, Light, Catppuccin Mocha
- Each theme defines ~50 color values as RGB triplets (e.g., "10 10 10")
- React Context API: `useTheme()` hook returns `{ themeId, theme, setTheme, themeIds }`
- `themeList` export for UI components to list available themes
- Applies CSS custom properties to `:root` on theme change (e.g., `--guide-bg: 10 10 10`)
- Persists selection to localStorage under `guIDE-theme-v2` key
- Sets `.theme-light` / `.theme-dark` class on `<html>` for conditional styles
- WHY: Every color in the UI now flows through CSS variables. Changing theme = changing all colors instantly. No component re-renders needed for styling.

### frontend/tailwind.config.js (MODIFIED)
- **ALL 50+ color values** changed from hardcoded hex (`#1e1e1e`) to CSS variable references
- Uses helper function `tc(name)` that generates `rgb(var(--guide-${name}) / <alpha-value>)` format
- This enables Tailwind opacity modifiers (e.g., `bg-vsc-accent/20`) to work with CSS variables
- Removed deprecated colors: `vsc-find-highlight`, `vsc-diff-added`, `vsc-diff-removed`, `vsc-merge-current`, `vsc-merge-incoming` (these used embedded alpha values incompatible with RGB triplet format)
- Added `font-brand: ['Audiowide', sans-serif]` for guIDE branding font
- Changed `font-vsc-ui` to use Inter instead of Segoe WPC

### frontend/src/index.css (MODIFIED)
- **Added**: Google Fonts import for Audiowide and Inter fonts
- **Added**: Default CSS custom properties in `:root` block — Monolith theme values as fallback before JS loads
- **Added**: `color-scheme: dark` on `html`, `color-scheme: light` for `.theme-light`
- **Added**: `-webkit-font-smoothing: antialiased` for crisp text rendering
- **Added**: `::selection` using theme selection color
- **Added**: Full scrollbar theming (`::-webkit-scrollbar-*`) using theme colors
- **Changed**: Focus ring from hardcoded `#007acc` to `rgb(var(--guide-accent))`
- **Changed**: Activity bar active indicator from `bg-vsc-text-bright` to `rgb(var(--guide-accent))`
- **Changed**: Editor tab active border-top from `#007acc` to `rgb(var(--guide-accent))`
- **Changed**: Chat message `pre` from `bg-[#0d0d0d]` to `bg-vsc-bg` (theme-aware)
- **Changed**: Chat message inline `code` from `bg-[#383838]` to `bg-vsc-input` (theme-aware)
- **Changed**: Statusbar item hover from `bg-white/10` to `bg-vsc-text-bright/10`
- **Changed**: Tab close button hover from `bg-white/10` to `bg-vsc-list-hover`
- **Added**: Glassmorphism utility classes: `.glass`, `.glass-subtle`, `.glass-strong`
- **Added**: `.font-brand` utility for Audiowide font
- **Added**: `.glow-accent` utility for accent-colored box shadow
- **Added**: `.no-select` utility

### frontend/src/App.jsx (MODIFIED)
- Added import for ThemeProvider
- Wrapped `<Layout />` in `<ThemeProvider>` — all children now have access to `useTheme()`

### frontend/src/components/TitleBar.jsx (MODIFIED)
- Added Audio Wide branded "guIDE" logo (left side, `font-brand text-vsc-accent`)
- Menu buttons use `text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover` (theme-aware)
- Border changed to `border-vsc-panel-border/50` for subtlety
- Removed unused imports (Minus, Square, X)

### frontend/src/components/ChatPanel.jsx (MODIFIED — MAJOR)
- **Unified input container**: Replaced separate textarea+button with cohesive rounded container
  - Rounded border container (`rounded-xl border border-vsc-panel-border/60 bg-vsc-sidebar`)
  - Textarea is now borderless inside the container, auto-resizes (28px min, 200px max)
  - Placeholder changes based on state (generating vs idle vs no model)
- **Bottom toolbar row** inside the input container:
  - Attach button (Paperclip icon) — stub, ready for implementation
  - Voice input button (Mic icon) — stub
  - Separator
  - Auto mode toggle (Zap icon + "Auto") — highlighted with accent/15 when active
  - Plan mode toggle (FileCode icon + "Plan") — highlighted with purple when active
  - Separator
  - Model picker button (Cpu icon + model name + chevron) — opens dropdown
  - Send button (ArrowUp) / Stop button (Square) — rightmost, accent-colored
- **Model picker dropdown**: Appears above the toolbar, lists available LLM models with load action
  - Glass-strong styling, themed
  - Current model has checkmark indicator
  - Backdrop click to close
- **Header**: Changed from "AI Chat" to brand "guIDE Chat" with Audiowide-styled label
- **Messages**: Warning boxes use `rounded-lg` and `border-vsc-warning/20` (subtler)
- **Removed**: Direct import of `invoke` from websocket (now uses dynamic import)

### frontend/src/components/StatusBar.jsx (MODIFIED)
- **Added**: ContextRing SVG component — circular progress indicator for context usage
  - 14px SVG with background circle and progress arc
  - Color-coded: green (<60%), accent (60-85%), yellow (>85%)
  - Smooth transition animation on dasharray changes
- **Changed**: Context display from "Ctx: 47%" text to ring + percentage
- **Changed**: `text-white` to `text-vsc-text-bright` (theme-aware)
- **Removed**: Unused import (CheckCircle)

### frontend/src/components/ActivityBar.jsx (MODIFIED)
- Border changed to `border-vsc-panel-border/30` for subtlety
- Removed unused `bottomActivities` constant

### frontend/src/components/Sidebar.jsx (MODIFIED)
- **Added**: Theme selector in Settings panel
  - Lists all 10 themes with active indicator (accent highlight)
  - Theme type label (dark/light) shown next to each name
  - Uses `useTheme()` hook from ThemeProvider
  - New import: Palette icon from lucide-react
- **Changed**: All `hover:bg-white/10` to `hover:bg-vsc-list-hover` (3 locations)

### frontend/src/components/BottomPanel.jsx (MODIFIED)
- **Changed**: `hover:bg-white/10` to `hover:bg-vsc-list-hover` (2 locations)

### frontend/src/components/Notifications.jsx (MODIFIED)
- **Changed**: `hover:bg-white/10` to `hover:bg-vsc-list-hover` (1 location)

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Welcome screen title uses `font-brand text-vsc-accent` (Audiowide font, theme accent color)

### UI_REBUILD_CHECKLIST.md (NEW)
- Created comprehensive checklist tracking ALL UI features to be built
- 16 major sections, ~150+ individual items
- Purpose: persist across context resets so nothing gets forgotten between sessions

---

## 2026-03-28 — Chat Message Rendering, Code Blocks, File Explorer Enhancements

### frontend/src/components/chat/CodeBlock.jsx (NEW)
- Syntax-highlighted code block component with toolbar
- Language label (top-left) shows detected language
- Copy button with clipboard API (fallback for non-secure contexts), shows checkmark on success
- Apply-to-file button (stub, ready for editor integration)
- Word wrap toggle
- Optional line numbers
- Receives pre-highlighted HTML from rehype-highlight via MarkdownRenderer
- Themed: uses vsc-bg, vsc-sidebar, vsc-panel-border, vsc-text-dim colors

### frontend/src/components/chat/MarkdownRenderer.jsx (NEW)
- ReactMarkdown wrapper with syntax highlighting and custom components
- Uses rehype-highlight (already in package.json) for automatic code syntax highlighting
- Uses remark-gfm for tables, strikethrough, autolinks
- Custom component overrides:
  - `code` → delegates to CodeBlock for block code, styled inline code for inline
  - `pre` → transparent wrapper (CodeBlock handles the container)
  - `table/thead/th/td` → themed table with proper borders and header background
  - `blockquote` → accent-colored left border
  - `a` → opens in new tab with noopener
  - `img` → responsive with rounded border
  - `h1/h2/h3` → text-vsc-text-bright

### frontend/src/components/chat/ToolCallCard.jsx (NEW)
- Displays tool calls with collapsible params/result sections
- Header: tool name + status indicator (spinner for pending, check for success, X for error)
- Duration display in milliseconds
- Params section: collapsible, shows JSON formatted parameters
- Result section: collapsible, error text in red
- Uses Wrench icon for tool identification

### frontend/src/components/ChatPanel.jsx (MODIFIED)
- Replaced ReactMarkdown import with MarkdownRenderer component
- Replaced remark-gfm import (now handled inside MarkdownRenderer)
- Added ToolCallCard import for tool call rendering
- Messages now render tool calls via ToolCallCard (reads msg.toolCalls array)
- Messages now show timestamp (HH:MM format) next to role label
- Streaming text now shows blinking cursor (streaming-cursor class)
- Assistant messages use MarkdownRenderer instead of inline ReactMarkdown

### frontend/src/components/Sidebar.jsx (MODIFIED)
- **FileIcon**: Replaced flat colorMap with rich iconMap using type-specific lucide icons:
  - FileCode for code files (.js, .jsx, .ts, .tsx, .py, .rs, .go, .java, etc.)
  - FileType for style files (.css, .scss, .sass, .less)
  - FileJson for data files (.json, .jsonc)
  - FileText for text files (.md, .txt, .log)
  - FileCog for config files (.yaml, .toml, .env, .gitignore, etc.)
  - File (generic) for unrecognized extensions
- **FileTreeItem**: Added right-click context menu support:
  - onContextMenu handler captures click position
  - Context menu actions: New File, New Folder (directories only), Rename, Copy Path, Delete
  - Each action calls appropriate /api/files/* endpoint
  - Uses addNotification for success/error feedback
- **FileContextMenu**: New component:
  - Fixed-position menu at cursor location
  - Closes on click outside, Escape key, or action completion
  - Viewport-aware positioning (clamps to prevent overflow)
  - Uses existing .context-menu CSS classes
- New imports: useState → useState + useRef + useEffect; added FileText, FileCode, FileJson, FileType, FileCog, Pencil, Trash2, Copy from lucide-react

### frontend/src/index.css (MODIFIED)
- **Added**: Streaming cursor animation:
  - `.streaming-cursor` class: 2px-wide accent-colored bar with blink animation
  - `@keyframes blink-cursor`: step-end infinite 0.8s cycle
- **Added**: Code wrap toggle utility (`.code-wrap pre { white-space: pre-wrap }`)
- **Added**: Full highlight.js token color scheme using CSS variables:
  - `.hljs-keyword` → accent color
  - `.hljs-string` → success color (green)
  - `.hljs-number` → info color (blue)
  - `.hljs-comment` → text-dim (italic)
  - `.hljs-title` → warning color (yellow)
  - `.hljs-type` → accent-hover
  - `.hljs-tag .hljs-name` → error color (red for HTML tags)
  - `.hljs-attribute/.hljs-property` → info color
  - `.hljs-regexp` → error color
  - `.hljs-addition/.hljs-deletion` → success/error with subtle background
  - All colors adapt automatically when theme changes

---

## 2026-03-28 — Editor Tabs, Terminal, Settings, Command Palette, Layout Polish (Feature Group 3)

### frontend/src/stores/appStore.js (MODIFIED)
- Added default `settings` object: temperature (0.7), topP (0.9), topK (40), maxResponseTokens (4096), maxIterations (10), gpuLayers (-1)
- Added `updateSetting(key, value)` action — immutably updates single setting key
- Added terminal tab state: `terminalTabs` array (starts with 1 default tab), `activeTerminalTab` string
- Added terminal tab actions: `addTerminalTab()`, `closeTerminalTab(id)`, `setActiveTerminalTab(id)` — auto-selects nearest tab on close

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Added `TabFileIcon` component — type-specific lucide icons matching Sidebar's icon pattern
- Added `TabContextMenu` component — right-click menu on tabs: Close, Close Others, Close All, Copy Path
- Added `handleCloseTab` — confirmation dialog for modified files before closing
- Tab bar uses `onContextMenu` handler and TabFileIcon

### frontend/src/components/BottomPanel.jsx (MODIFIED — MAJOR OVERHAUL)
- Replaced text-based `TerminalPanel` with `XTermPanel` using xterm.js
- Terminal sub-tabs: create/switch/close via appStore
- XTermPanel: dynamic imports, CSS-variable-aware theme, cursor blink/bar, 5000 scrollback, ResizeObserver auto-fit
- Input handling: Enter (execute via /api/terminal/execute), Backspace, printable chars

### frontend/src/components/Sidebar.jsx (MODIFIED — SettingsPanel)
- SettingsPanel: added Inference section with 6 controls (Temperature, TopP, TopK, MaxResponseTokens, MaxIterations, GPULayers)
- New `SettingSlider` reusable component with themed range input

### frontend/src/components/CommandPalette.jsx (MODIFIED)
- Added 10 dynamic theme commands from ThemeProvider's `themeList`
- Added New File, New Terminal, Close All Tabs commands
- Category group separator headers in filtered list
- Max height 300px with overflow scroll

### frontend/src/components/ThemeProvider.jsx (MODIFIED)
- Added `guide-set-theme` CustomEvent listener for CommandPalette theme switching

### frontend/src/components/Layout.jsx (MODIFIED)
- `onDoubleClick` on all 3 splitters to toggle panels
- Transparent resize overlay to prevent iframe pointer capture during drag

### frontend/src/index.css (MODIFIED)
- Splitter `::after` hover indicator with accent color at 40% opacity
- Range input global styling (custom slider thumb + track)

---

## 2026-03-28 — Monaco Cursor, Search, Git, PTY Terminal, Error Boundary (Feature Group 4)

### frontend/src/stores/appStore.js (MODIFIED)
- Added `editorCursorPosition: { line: 1, column: 1 }` and `setEditorCursorPosition(pos)` action
- Added global search state: `searchQuery`, `searchResults`, `searchLoading`, `setSearchQuery`, `setSearchResults`, `setSearchLoading`
- Added tool toggle state: `enabledTools: {}`, `toggleTool(name)` action (boolean map keyed by tool name)

### frontend/src/components/EditorArea.jsx (MODIFIED)
- Added `editorRef` useRef to hold Monaco editor instance
- Added `setEditorCursorPosition` from appStore
- Added `onMount` callback to Monaco: tracks cursor position via `editor.onDidChangeCursorPosition`, updates store on every cursor move

### frontend/src/components/StatusBar.jsx (MODIFIED)
- Added `cursorPos` from appStore (`editorCursorPosition`)
- Replaced hardcoded "Ln 1, Col 1" with dynamic `Ln {cursorPos.line}, Col {cursorPos.column}`

### frontend/src/components/Sidebar.jsx (MODIFIED — MAJOR)
- **SearchPanel**: Complete rewrite — debounced search (300ms) via `GET /api/files/search`, results grouped by file in `SearchFileGroup` component, expandable file groups with line numbers and match text, replace input toggle, loading/empty states, file opening on match click
- **SearchFileGroup**: New sub-component — expandable file group showing match count badge, individual match lines with line number and text excerpt
- **GitPanel**: Complete rewrite — fetches `GET /api/git/status`, shows branch name (GitBranch icon), staged/modified/untracked sections via `GitFileSection` component (A/M/U status badges with green/yellow/gray colors), refresh button with animated spin
- **GitFileSection**: New sub-component — expandable section for staged/modified/untracked files with status badge
- **ToolToggles**: New sub-component — displays 10 tools (read_file, write_file, list_directory, execute_command, search_files, browser_navigate, browser_screenshot, browser_click, git_status, git_commit) with ToggleRight/ToggleLeft icons, reads from `enabledTools` store
- **KeyboardShortcuts**: New sub-component — 15 shortcuts displayed as action + styled kbd tag
- **SettingsPanel**: Added ToolToggles and KeyboardShortcuts sections below existing inference controls
- **New constants**: `AVAILABLE_TOOLS` (10 tools), `KEYBOARD_SHORTCUTS` (15 shortcuts)
- **New imports**: GitBranch, Search (as SearchIcon), Keyboard, Wrench, ToggleLeft, ToggleRight from lucide-react

### frontend/src/components/ErrorBoundary.jsx (NEW)
- React class component error boundary wrapping entire app
- Catches render errors, displays error message + component stack trace
- "Try to Recover" button (clears error state) and "Reload Page" button
- Dark themed UI matching app styling

### frontend/src/App.jsx (MODIFIED)
- Imported ErrorBoundary component
- Wrapped `<ThemeProvider><Layout /></ThemeProvider>` in `<ErrorBoundary>`

### frontend/src/components/Layout.jsx (MODIFIED)
- Added `modelLoading` and `modelLoadProgress` from appStore
- Added model loading overlay: fixed bottom toast with spinner + progress bar (only visible when modelLoading=true)

### frontend/src/components/BottomPanel.jsx (MODIFIED — MAJOR)
- **XTermPanel rewritten for WebSocket PTY**:
  - Opens WebSocket to `/ws/terminal` on mount
  - Sends `{type:'create', terminalId, cols, rows}` to spawn PTY process
  - PTY mode: `xterm.onData` → `ws.send({type:'input'})`, `ws.onmessage({type:'output'})` → `xterm.write()`
  - Resize: ResizeObserver + window resize → `ws.send({type:'resize', cols, rows})`
  - Handles `{type:'ready'}` (PTY connected), `{type:'exit'}` (process ended), `{type:'no-pty'}` (fallback)
  - Exec fallback: if node-pty unavailable or WebSocket fails, falls back to line-by-line REST execution via `/api/terminal/execute`
  - Uses `modeRef` (useRef) instead of state for mode tracking inside closures
  - Cleanup: closes WebSocket + disposes xterm on unmount
- **_setupExecMode**: Extracted as standalone function for exec fallback input handling

### server/main.js (MODIFIED — MAJOR)
- **New REST endpoints**:
  - `GET /api/files/search` — Recursive text search with query/path params, 200 result limit, skips >1MB files, searches 6 levels deep, excludes node_modules/.git/dist/build
  - `GET /api/git/status` — Runs `git rev-parse --abbrev-ref HEAD` + `git status --porcelain`, parses X/Y columns into staged/modified/untracked arrays with file paths
  - `POST /api/files/create` — Creates new file with content, 409 if already exists
  - `POST /api/files/delete` — Deletes file or directory (recursive), validates path within project
  - `POST /api/files/rename` — Renames/moves file within project
  - `POST /api/terminal/execute` — Legacy exec fallback using execSync with 30s timeout, 5MB buffer
- **PTY WebSocket system**:
  - `require('node-pty')` with try-catch graceful fallback
  - `ptyTerminals` Map tracking active PTY processes by terminal ID
  - Separate `WebSocket.Server` at `/ws/terminal` using `noServer: true`
  - Server upgrade handler: routes `/ws/terminal` to PTY WSS, all other paths to Transport's WSS
  - Message protocol: `create` (spawn powershell/bash), `input` (write to PTY), `resize` (resize PTY)
  - PTY events: `output` (data from process), `exit` (process ended with code), `ready` (PTY connected), `no-pty` (node-pty not available)
  - Cleanup: kills PTY process + removes from map on WebSocket close

---

## 2026-03-27 — 147% Context Bug Fix (Session 2)

### .github/copilot-instructions.md (NEW)
- Created full copilot instructions file for guide-2.0 project
- Ported from old IDE project's copilot-instructions.md, adapted for guide-2.0 architecture
- Includes: RULE -1 (always end with vscode_askQuestions), banned words, PRE-CODE/POST-CODE checklists, debugging rules, testing methodology, server rules, all 7 recurring failure patterns

### llmEngine.js — Part A: eraseContextTokenRanges instead of sequence disposal
- **Lines ~955-990** (EOS-sequence protection in `_runGeneration()`):
  - REMOVED: Disposing sequence and chat, then recreating both (destroyed KV cache, caused "No sequences left")
  - ADDED: `this.sequence.eraseContextTokenRanges([{ start: 0, end: this.sequence.nextTokenIndex }])` — clears KV cache without destroying the sequence
  - ADDED: Fallback path if eraseContextTokenRanges fails — disposes and recreates with correct context size via `_computeRecoveryContextSize()`
  - WHY: When agenticLoop's pre-gen compression set `lastEvaluation=null`, the old code disposed the sequence, got "No sequences left", then recreated the context at the wrong size (60269 instead of 8192). This caused the 147% display and the model stopping.

### llmEngine.js — Part B: Fix all modelSizeGB recovery paths
- **Lines ~624-652**: Added `_getModelSizeGB()` helper — computes `(this.modelInfo?.size || 0) / (1024 ** 3)` instead of using nonexistent `this.modelInfo?.modelSizeGB`
- **Lines ~653-670**: Added `_computeRecoveryContextSize()` helper — computes correct context size for recovery, applies TEST_MAX_CONTEXT clamping, logs the clamping
- **5 locations replaced** (previously at lines 932, 963, 1239, 1506, 1539): All now use `_computeRecoveryContextSize()` instead of inline computation with `this.modelInfo?.modelSizeGB || 0`
- **All recovery paths** now update `this.modelInfo.contextSize` after context recreation to keep the status bar denominator in sync
- WHY: `modelInfo` stores model file size as `.size` (bytes), NOT `.modelSizeGB`. Every recovery path was computing `modelSizeGB=0`, giving `_computeGpuContextSize` a 0-byte model, resulting in 60269 context instead of 8192. This was the root cause of the 147% display.

---

## 2026-03-27 — Initial Bootstrap Session

### package.json (NEW)
- Created root package.json with dependencies: node-llama-cpp, express, ws, cors, chokidar, node-pty, mime-types
- Scripts: start, dev, frontend:dev, frontend:build, tauri:dev, tauri:build

### pipeline/contextManager.js (NEW)
- Created missing module that agenticLoop.js imports (lines 20-24)
- Implements three post-loop maintenance functions:
  - `postLoopCompaction()` — collapses intermediate tool result entries after agentic loop completes
  - `shouldSummarize()` — checks if context usage warrants summarization (>60% usage + >6 history entries, or >20 entries)
  - `summarizeHistory()` — generates compact summary and replaces old entries to free context
- These are NOT the old proactive rotation contextManager (that was intentionally removed). These are post-loop cleanup functions.

### logger.js (MODIFIED)
- Line 146: Changed `require('../package.json')` to `require('./package.json')` with try-catch fallback
- Reason: package.json is in the same directory as logger.js, not parent. Added safe fallback to prevent crash if package.json is missing.

### server/ipcBridge.js (NEW)
- IpcMainBridge class: drop-in replacement for Electron's ipcMain.handle()
- MainWindowBridge class: drop-in replacement for mainWindow.webContents.send()
- createAppBridge function: replaces Electron's app.getPath() with OS-native paths
- All three allow the pipeline code to run without Electron installed

### server/transport.js (NEW)
- WebSocket transport layer managing client connections
- Routes incoming invoke messages to IPC bridge handlers
- Routes outgoing pipeline events to connected WebSocket clients
- Handles connection lifecycle, reconnection, message serialization

### server/main.js (NEW)
- Main server entry point: Express HTTP + WebSocket
- Electron module shim (intercepts require('electron') with bridge objects)
- REST API: /api/models, /api/project, /api/files, /api/settings, /api/session, /api/gpu, /api/health
- Loads and wires ALL pipeline modules (llmEngine, mcpToolServer, agenticChat, etc.)
- Serves built frontend from frontend/dist/
- Auto-loads default model if available

### server/_electronShim.js (AUTO-GENERATED)
- Created by server/main.js at startup
- Exports bridge objects (ipcMain, app, BrowserWindow, dialog, shell, Menu, etc.)
- Allows require('electron') to succeed in non-Electron environments

### frontend/ (NEW — complete VS Code clone UI)
- package.json: React 19, Monaco Editor, Vite 6, TailwindCSS 3, Zustand 5, Lucide icons, react-markdown
- vite.config.js: Vite config with API proxy for dev mode, Monaco chunking
- tailwind.config.js: Full VS Code Dark+ theme colors, fonts, sizes, animations
- postcss.config.js: TailwindCSS + Autoprefixer
- index.html: HTML entry with critical CSS, custom scrollbars
- src/index.css: Comprehensive VS Code component styles (activity bar, tabs, file tree, chat, panels, etc.)
- src/main.jsx: React entry point
- src/App.jsx: Root component — WebSocket connection, event routing to Zustand store, keyboard shortcuts
- src/stores/appStore.js: Global state (connection, model, project, editor tabs, chat, panels, notifications, etc.)
- src/api/websocket.js: WebSocket client with reconnection, invoke/send, event routing
- src/components/Layout.jsx: VS Code layout with resizable panels
- src/components/TitleBar.jsx: Custom title bar with menus, model indicator, connection dot
- src/components/ActivityBar.jsx: Left icon strip with Explorer/Search/Git/Debug/Extensions/Chat/Settings
- src/components/Sidebar.jsx: File explorer with recursive tree, search panel, git panel, settings/model manager
- src/components/EditorArea.jsx: Monaco Editor with tabs, breadcrumbs, welcome screen
- src/components/ChatPanel.jsx: AI chat with streaming markdown, thinking blocks, tool progress, todo display
- src/components/BottomPanel.jsx: Terminal/Output/Problems tabs with command input
- src/components/StatusBar.jsx: Branch, errors, line/col, encoding, language, context usage, model, connection
- src/components/CommandPalette.jsx: Ctrl+Shift+P overlay with fuzzy search, 15+ commands
- src/components/Notifications.jsx: Toast notifications with info/warning/error/success types

### frontend/package.json (MODIFIED)
- Fixed xterm package names: xterm -> @xterm/xterm, xterm-addon-fit -> @xterm/addon-fit, etc.

# REVERTED FIXES — DO NOT RE-IMPLEMENT

> Every fix listed below was implemented after R21 testing and reverted on 2026-03-28.
> These fixes either didn't solve the problems they targeted or made things worse.
> **DO NOT re-implement any of these approaches without fundamentally different reasoning.**

---

## WHY REVERTED

R20 test: 674 lines, 6 context shifts, file written to disk — working.
R21 test: 348 lines, content generating — partially working.
R24 test (after all these fixes): file NOT written to disk at all — regression.

18 changes across 7 files accumulated without net improvement. Each fix addressed
a symptom observed in one test, then the next test revealed new issues caused by
the fix or the same underlying problem. The cycle repeated 3 times (R22, R22-bugs, R23).

---

## REVERTED CHANGES — FULL LIST

### 1. R22-Fix-A3: completedFiles guard (agenticLoop.js)
- **What it did**: Added a `completedFiles` Set to track structurally complete files. Blocked write_file/append_to_file/create_file to files in the set.
- **Why it failed**: Too aggressive. Blocked legitimate append_to_file continuations after context rotation. R23-Fix-3 had to weaken it (remove append_to_file from blocked list), proving the original design was wrong.
- **DO NOT**: Add any mechanism that blocks tool calls based on past file writes. The model needs freedom to continue files.

### 2. R23-Fix-3: Allow append_to_file through A3 guard (agenticLoop.js)
- **What it did**: Removed append_to_file from the A3 guard's blocked tool list.
- **Why it failed**: Band-aid on a band-aid. The A3 guard itself was the wrong approach (see #1).
- **DO NOT**: Modify the A3 guard further. Remove the guard entirely.

### 3. R23-Fix-2: D6 regex un-anchoring + effectiveRawText (agenticLoop.js)
- **What it did**: Removed `^` anchor from D6's second regex pattern. Added `effectiveRawText` variable to split pre-tool content from tool call when tool call appeared mid-text.
- **Why it failed**: Added complexity to D6 detection without addressing the root cause (model output format inconsistency). The original `^`-anchored regex was more conservative and correct for its purpose.
- **DO NOT**: Remove the `^` anchor from D6 regex. DO NOT add `effectiveRawText` split logic.

### 4. R23-Fix-1: R16-Fix-B "check completeness" message (agenticLoop.js)
- **What it did**: Changed the R16-Fix-B else branch message from "file saved, provide summary" to a lengthy message asking the model to review completeness and continue with append_to_file if incomplete. Removed `completedFiles.add(fp)`.
- **Why it failed**: The message change was based on one test observation (R23 premature termination). The original "provide summary" message was actually correct behavior for the natural-stop case.
- **DO NOT**: Change the R16-Fix-B else branch message to ask for completeness checks. The model stopped naturally — trust it.

### 5. R22-Fix-3: Strip trailing artifacts in Fix-M (agenticLoop.js)
- **What it did**: After overlap detection in Fix-M path, stripped ` ```] ` and ` }} ] ` patterns from continuation content.
- **Why it failed**: Addressed a symptom (model emitting markdown fences in raw continuation) with regex heuristics that could strip legitimate content.
- **DO NOT**: Add regex stripping of trailing patterns in the Fix-M path.

### 6. R22-Fix-4: Decode JSON escapes in Fix-M (agenticLoop.js)
- **What it did**: When continuation content contained literal `\n` or `\"`, decoded JSON escape sequences before appending to file.
- **Why it failed**: The model outputting JSON-escaped content in raw continuation is a symptom of the model being confused about output format. Silently unescaping masks the confusion.
- **DO NOT**: Add JSON unescape logic in the Fix-M continuation path.

### 7. R22-Fix-1-gap: Single-quote holdback strip (streamHandler.js)
- **What it did**: Changed `held.replace(/"\s*}\s*}?\s*$/, '')` to `held.replace(/['"]\s*}\s*}?\s*$/, '')` in finalize holdback.
- **Why it failed**: Part of a set of single-quote accommodation changes. The model using single quotes is the real problem; accommodating it everywhere adds complexity.
- **DO NOT**: Change the holdback strip regex to match single quotes.

### 8. R22-Fix-2-gaps: Decision buffer + JSON unescape (streamHandler.js)
- **What it did**: Replaced simple `_fileContentActive` routing in `onToken()` with a decision buffer (`_rawContBuffer`). Accumulated tokens, classified as code or prose based on character analysis after 30-200 chars. Added `_unescapeJsonContent()` helper.
- **Why it failed**: The decision buffer added significant complexity (30+ lines of new logic) for a marginal benefit. Classification heuristics (code chars vs prose) are unreliable. The original simple routing (send everything to file-content-token when active) was crude but predictable.
- **DO NOT**: Add a decision buffer in onToken(). DO NOT classify tokens as code vs prose.

### 9. R22-Fix-1: Single-quote content detection (streamHandler.js)
- **What it did**: Changed `/"content"\s*:\s*"/` to `/"content"\s*:\s*['"]/` at two locations in _streamFileContent.
- **Why it failed**: Same as #7 — accommodating model quirks adds complexity without fixing root cause.
- **DO NOT**: Change content detection regex to match single quotes.

### 10. R22-Fix-2: Raw continuation routing (streamHandler.js)
- **What it did**: In onToken(), when `_fileContentActive` is true, routed unsent buffer to file-content-token instead of llm-token.
- **Why it failed**: This is what the decision buffer (#8) replaced. Both approaches tried to solve the same problem (raw continuation after context shift going to wrong event channel). The decision buffer was the worse approach; this simpler one was also removed because it was entangled.
- **DO NOT**: Add routing logic based on `_fileContentActive` flag in onToken() before `_flush()`.

### 11. R22-Fix-B1: Fresh getState() after async (ChatPanel.jsx)
- **What it did**: After the async `invoke()` call, replaced stale `store.*` reads with fresh `useAppStore.getState()`.
- **Why it failed**: Conceptually correct (state IS stale after a 2+ min async call), but the implementation was tangled with Fix 6 (fileBlocks storage in message object). Both stored fileBlocks in the message, created a new rendering path.
- **DO NOT**: Store fileBlocks directly in message objects. Let the existing finalization compose markdown fences.

### 12. R22-Fix-6: Permanent FileContentBlock rendering (ChatPanel.jsx)
- **What it did**: On finalization, instead of composing file blocks into markdown code fences, stored `fileBlocks` array in the message object. Message renderer checked for `msg.fileBlocks` and rendered FileContentBlock components.
- **Why it failed**: Created a parallel rendering path. Message objects now had two formats (markdown content vs fileBlocks array). Code that expected markdown content broke.
- **DO NOT**: Store fileBlocks in message objects. DO NOT create a parallel rendering path.

### 13. R22-Fix-B2: Welcome screen responsive grid (EditorArea.jsx + index.css)
- **What it did**: Changed `sm:grid-cols-2` to `lg:grid-cols-2`, `gap-6` to `gap-4`, `max-w-lg` to `max-w-xl`. Changed `p-8` to `p-4 sm:p-8` in index.css.
- **Why it failed**: Cosmetic change unrelated to core pipeline. No functional impact, but part of the batch being reverted.
- **DO NOT**: Priority is pipeline correctness, not UI layout tweaks.

### 14. R22-Fix-B3: Breadcrumb overflow (EditorArea.jsx)
- **What it did**: Added `overflow-hidden`, `min-w-0`, `flex-1` wrapper div for breadcrumb path with truncation.
- **Why it failed**: Cosmetic change unrelated to core pipeline.
- **DO NOT**: Priority is pipeline correctness, not UI layout tweaks.

### 15. R22-Fix-5: likelyLong collapse proxy (FileContentBlock.jsx)
- **What it did**: Added `likelyLong` variable based on `content.length > 500`. Used it as initial collapse state when `lineCount === 0`.
- **Why it failed**: Cosmetic fix for flash-full-then-collapse glitch. Not a pipeline issue.
- **DO NOT**: Priority is pipeline correctness, not UI animation tweaks.

### 16. R22-Fix-A1: setBrowserManager call (server/main.js)
- **What it did**: Added `mcpToolServer.setBrowserManager({ parentWindow: mainWindow })` after MCPToolServer construction.
- **Why it failed**: The setBrowserManager method was defined but the feature it supports (file explorer auto-refresh) was never tested.
- **DO NOT**: Wire browserManager until the feature is actually needed and tested.

### 17. R22-Fix-A2: isActivated false (server/main.js)
- **What it did**: Changed `isActivated: true` to `isActivated: false` in license stub.
- **Why it failed**: Cosmetic — changes account display from "Licensed User" to sign-in form. No functional impact.
- **DO NOT**: Priority is pipeline correctness.

---

## THE REAL UNSOLVED PROBLEM

The R24 test revealed the ACTUAL issue: the model outputs malformed JSON in its tool call.
Instead of `"params":{"filePath":` it outputs `"params\":{\"filePath\":` — mixing escaped and
unescaped quotes. `JSON.parse()` fails. `parseResponse` returns 0 tool calls. The file is
never written to disk.

None of the 18 reverted changes addressed this. This is a `responseParser.js` issue — the
JSON repair logic (`tryFixJson`) cannot handle structurally malformed key names with escaped quotes.

This is the problem that actually needs solving.

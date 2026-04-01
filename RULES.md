# guIDE 2.0 — Agent Rules, Standards & Expectations

> This document consolidates all rules, standards, quality expectations, and testing methodology
> for the guIDE project. It is the single source of truth. Every AI agent working on this
> project must read this ENTIRE document before making any change. No exceptions.

---

## 1. WHAT IS guIDE

guIDE is a **local-first, offline-capable AI IDE**. The quality target is Visual Studio Code + GitHub Copilot, but running entirely locally with no cloud dependency. It ships to real end users on all hardware configurations from 4GB GPU laptops to 128GB RAM workstations, running 0.5B to 200B parameter models.

**Core principle:** This is production software. Every change must be production-grade, general (works for ALL users, ALL models, ALL hardware), and complete.

---

## 2. THE CORE GOAL

**Context size should NOT matter.** A model with a 2,000 token context window should be able to print a MILLION lines of code — coherently, from start to finish, without losing track, without restarting, without content regression.

The pipeline has three systems to make this possible:
1. **Seamless continuation** — when generation hits maxTokens, the pipeline continues in the same response without user intervention
2. **Context summarization** — long conversation history is summarized to preserve space
3. **Native context shift** (Solution A) — when context fills, node-llama-cpp's built-in context shift fires with a custom strategy that intelligently compresses history while keeping the model's current partial output intact

Until these three systems work reliably together, everything else (UI polish, response quality tuning) is secondary.

**Success looks like:**
- Model starts writing a large file
- Hits maxTokens → seamless continuation picks up exactly where it left off
- Context fills → context shift fires, model remembers the task and continues from the right place
- File grows monotonically (never shrinks, never restarts from scratch)
- Final output is coherent and complete

**Failure looks like:**
- Line count drops (content lost during continuation/rotation)
- Model restarts the file from scratch after context shift
- Model produces duplicate content
- Model stalls during continuation
- Model loses track of what it was doing
- Filename changes after context shift (lost awareness of what it was building)

---

## 3. QUALITY STANDARDS — NON-NEGOTIABLE

### Read code before responding
- Never assume you know what the code looks like. Read the relevant files first.
- "I assumed" is never acceptable. Verify everything with actual file reads.

### Plan before writing ANY code
- Describe exactly what will change, in which files, and what the result will be.
- Wait for explicit approval. Execute EXACTLY what was described — no more, no less.
- If the plan needs to change mid-implementation, STOP and re-present.

### No band-aid fixes — deep infrastructural fixes only
- When a bug is found, the fix MUST address the root architectural cause.
- Do NOT propose surface-level patches, workarounds, guard clauses, or timeouts that mask deeper issues.
- Every fix must be deep, hard, and infrastructural — addressing WHY the system produces wrong behavior, not just catching the wrong output.
- A band-aid fix is a lie — it pretends the problem is solved while leaving the broken mechanism intact.

### Never say "done" without proof
- A feature is real and functional, or it is not done. No middle ground.
- Never claim code works without verifying it. If something failed, say it failed.
- Double-check your work. Then check it again.

### No half-assing — EVER
- Every feature must be fully implemented end-to-end.
- If a feature has a UI component AND a backend component, implement BOTH.
- A feature is either 100% done or it's not done.

### No lazy shortcuts — EVER
- If the correct solution requires 500 lines of code, write 500 lines. Do not write 50 lines and call it done.
- Do not drop data, remove features, or simplify scope to make your job easier.
- Always aim for the BEST result, not the easiest result.

### No lying
- Do not say a feature is "done" when it's scaffolding, stubs, or placeholder code.
- Do not claim code works without verifying it compiles/runs.
- If something failed, say it failed.

### No fake data — EVER
- No mock data, placeholder content, hardcoded dummy entries.
- If real data doesn't exist yet, say so.

### No fabricated problems
- If code is correct, say it's correct. Do not invent issues to appear helpful.
- Do not suggest refactors, renames, or "improvements" just to produce output.
- Every reported issue must be a genuine, demonstrable bug.

### Hardware-agnostic always
- Every fix must work for 4GB GPU users AND 128GB workstation users.
- Never target a specific machine, GPU, or model size.
- Never hardcode context size numbers — always compute from actual available resources at runtime.
- Hardware-specific fixes are bugs.

### No cloud APIs as primary
- This is a local-first product. Cloud is not the answer.
- Never recommend cloud APIs as a primary path for anything local models can handle.

---

## 4. BANNED WORDS AND PATTERNS

### Words banned when describing code changes
- "confirmed" / "confirmed fixed" / "definitively confirmed"
- "fixed" (as a final declaration)
- "this resolves the issue"
- "the bug is now fixed" / "fully fixed"
- "this should fix it" (without a specific testable condition)
- "that's the root cause" (without tracing every code path)
- "ready" / "all set" / "working" / "everything's working"

**Why:** Every time these words are used, the user tests and finds it still broken. The words imply verification that cannot be done without running the app.

**Instead say:**
- "I changed [specific thing] in [specific file] at [specific line]. The specific behavior that should change is [X]. Test it and tell me if [X] is different."
- "I cannot verify this works — I can only verify the code change was made."

### Never blame model size or capability
- NEVER say "this is a model capability issue" or "the 4B model can't do this."
- The models used here have demonstrated correct tool use and reasoning in other environments.
- If a test fails, exhaust EVERY optimization lever before concluding anything.

### Never blame context window
- NEVER say "context window too small" or "ran out of context."
- The three context management systems exist to eliminate context size as a constraint.
- If context-related problems occur, the systems have a bug. Fix the bug.

---

## 5. RECURRING FAILURE PATTERNS — READ EVERY SESSION

### PATTERN 1 — "I've read all the relevant code" after skimming
Agent reads 20 lines, says "I now understand," proposes a fix, fix is wrong.
**Rule:** You have NOT read the code until you have traced the full call chain from where the broken value is produced to where it's displayed. Every function. Every file.

### PATTERN 2 — Proposing a revert as a "fix"
Fix A breaks something. Agent proposes reverting. But the state before Fix A was already broken.
**Rule:** A revert is NEVER a fix unless you can explain why the pre-fix state was correct.

### PATTERN 3 — Writing code without explicit approval
Agent analyzes a problem and immediately makes code changes, skipping the approval step.
**Rule:** The plan and the implementation are ALWAYS two separate responses.

### PATTERN 4 — Hardware-specific numbers
Agent reads the dev machine's GPU/RAM, calculates a "fix" based on those numbers. Ships it.
**Rule:** This is production software for ALL hardware. Any fix that only works on one machine is wrong.

### PATTERN 5 — Saying "I understand" when you don't
Agent is uncertain but constructs a confident explanation and acts on it.
**Rule:** "I don't know" is always acceptable. Guesses presented as analysis are not.

### PATTERN 6 — Forgetting session history
Context window rotates. Agent loses memory of previous decisions and repeats them.
**Rule:** Read CHANGES_LOG.md before proposing any fix.

### PATTERN 7 — "I found the root cause" from one indicator
Agent finds one plausible explanation, implements a fix, it doesn't work. Repeats 3-5 times.
**Rule:** Before declaring root cause:
1. Find the code path end-to-end (every function, actual file reads)
2. Verify the fix would close the gap (no other path produces the same bad output)
3. Find a SECOND independent indicator
4. Explicitly state what you DON'T know

### PATTERN 8 — Fabricating issues to appear helpful
User asks for a code audit or review. Agent produces a list of issues — regardless of actual code quality. Each agent run produces a DIFFERENT list. Issues are fabricated to seem productive.

**Why it's wrong:** The purpose of an audit is to find REAL problems grounded in observable behavior or demonstrable code defects. Generating issues that can't be reproduced, aren't observable, or don't exist in the code is lying.

**Rule:** A reported issue must meet ALL THREE criteria:
1. You can cite the exact file, function, and line where the problem exists
2. You can describe the specific observable symptom it produces (what the user sees or can measure)
3. You can explain why the code at that location causes that symptom

If any are missing: do NOT report it as an issue. Say "I see X in the code but I cannot confirm it causes a real problem without more investigation."

---

## 6. DEBUGGING RULES

### Root cause requirement
Do NOT stop after implementing a mitigation (timeout, watchdog, guard clause). Identify the underlying cause. A watchdog that masks a hang is NOT a fix.

### Full pipeline investigation
Before proposing ANY fix, trace the ENTIRE execution pipeline:
- Request initialization → context assembly → model inference → token generation → streaming → tool detection → tool execution → continuation → completion

### No minimal patches without proof
Do NOT propose one-line fixes unless you can demonstrate with evidence that the issue is truly isolated. For complex systems, minimal patches are usually insufficient.

### Evidence requirement
Every root cause claim must be supported by logs, execution tracing, or code analysis. Assumptions are not acceptable without verification.

### Stall diagnosis
When a generation stall occurs, determine which subsystem stopped:
- Model inference engine (C++ layer)
- Token sampling loop
- Streaming callback layer
- Buffering layer
- Agent execution loop
- Context management systems

"The generation hung" is not a diagnosis. Identify the EXACT subsystem.

---

## 7. PRE-CODE CHECKLIST — MANDATORY BEFORE EVERY CODE CHANGE

```
PRE-CODE CHECKLIST
==================
1. SYMPTOM: [exact observable behavior reported]
2. FILES READ: [every file and line range actually read]
3. FULL CALL CHAIN: [every function the broken value passes through, source to screen]
4. WHAT I HAVE NOT READ: [explicit list of skipped files/functions]
5. ALL CODE PATHS THAT COULD PRODUCE THE SYMPTOM: [not just the ones with log evidence]
6. SECOND INDEPENDENT INDICATOR: [something OTHER than the first clue]
7. PROPOSED CHANGE: [file, function, line range, what changes, observable effect]
8. PATHS NOT COVERED: [honest assessment]
```

The plan response must include this checklist. Code is written only AFTER approval.

---

## 8. POST-CODE VERIFICATION — MANDATORY AFTER EVERY CODE CHANGE

```
POST-CODE VERIFICATION
======================
1. CHANGE MADE: [file, function, line — exact]
2. EVERY OTHER LOCATION that produces the same bad output: [addressed? yes/no]
3. SPECIFIC OBSERVABLE BEHAVIOR: [before vs after]
4. WHAT WILL NOT CHANGE: [honest — what symptoms might persist?]
5. BANNED WORDS CHECK: [confirmed / fixed / resolves / fully fixed / ready / working / all set — present?]
```

---

## 9. TESTING METHODOLOGY

### Core Testing Principles
- The test suite exists to reveal REAL behavior, not to be satisfied.
- NEVER modify pipeline files to make a specific test pass.
- Be a normal user — typos, ambiguity, multi-part requests, edge cases.
- NEVER hand-hold the model on output format.
- Score ALL 3 dimensions for every test: coherence, tool correctness, response quality.

### The Three Scoring Dimensions
1. **Coherence** (50% weight) — Does the response make sense? Is it relevant?
2. **Tool correctness** (25% weight) — Were tools called when needed? Not called when not needed?
3. **Response quality** (25% weight) — Is the content accurate?

A test passes ONLY when ALL THREE are satisfactory. A single dimension failing = the test fails.

### Test Prompt Rules
- NEVER use the same prompt twice
- NEVER specify file length or how long the output should be
- Every prompt MUST stress context limits — ask for things that produce large output naturally
- Prompts must be complex, multi-part, realistic user requests
- NEVER instruct the model on HOW to generate output (e.g., "make sure to close HTML tags")

### During Generation — Constant Monitoring
- Screenshots every 5 seconds
- Watch for: line count changes, context % changes, speed changes
- If line count DROPS — that's a bug
- If filename changes after context shift — that's a coherence defect
- Let the model completely finish — NEVER end a test early

### Test Reporting Format
```
TEST: [exact prompt]
MODEL: [name and size]
CONTEXT SIZE: [tokens]
CONTINUATIONS: [count]
CONTEXT SHIFTS: [count]
FINAL OUTPUT: [line count, filename, coherence]
DEFECTS FOUND:
  - [specific defect with evidence]
LINE COUNT PROGRESSION: [e.g., 0 → 150 → 252 → 203 (REGRESSION)]
CONTENT INTEGRITY: [shrink? restart? duplicate?]
```

### The 6 Mandatory Test Dimensions
1. **Context Shift + Recall** — Fill context, verify recall after shift
2. **Seamless Continuation** — Output exceeding maxResponseTokens stitches correctly
3. **Long File Mid-Context-Shift** — Context shifts MID-file-generation, model resumes
4. **Todo List Across Shifts** — Plan survives context shift, model continues
5. **Summarization Quality** — Summary preserves goal, files, decisions, state
6. **Basic Sanity** — "hi", "2+2", "explain recursion" before heavy tests

### No Cheerleading — EVER
- Do NOT celebrate test results.
- Report ONLY defects and factual observations.
- If nothing is wrong, verify your testing is rigorous enough. Increase difficulty.
- Every test report must read like a hostile quality audit.

### Prompt/Profile Optimization — The 5 Levers (ONLY these are allowed)
1. System prompt / preamble text — `constants.js`
2. Tool descriptions — `mcpToolServer.js`
3. Sampling parameters — `modelProfiles.js` (temperature, topP, topK, repeatPenalty)
4. Grammar constraints — `modelProfiles.js`
5. Few-shot examples — `modelProfiles.js`

**One change per iteration. State what changed. If it makes things worse, revert immediately.**

### NEVER Allowed in Optimization
- Adding keyword/regex classifiers that match specific user phrasings
- Response filters targeting specific words from a test
- Hard-gating tool calls based on spotting specific phrases
- Any change that would only work for test inputs used during development

---

## 10. AGENT BEHAVIOR RULES

### Do NOT dismiss user observations
- When the user reports a bug, treat it as FACT until proven otherwise by your own evidence.
- If your analysis contradicts the user, YOUR ANALYSIS IS WRONG. Read more code.
- The user sees the running application. You see only code and logs. The user's observation is primary evidence.

### Do NOT be sycophantic
- When the user challenges a technical decision, do NOT automatically agree.
- If your position is correct, defend it with evidence.

---

## 13. CHANGELOG IS NOT CODE — NEVER TREAT IT AS CODE

**Permanently banned:** Generating any analysis, categorization, or assessment of "what code does" based on CHANGES_LOG.md or any other description/note without reading the actual code files.

**What this means:**
- CHANGES_LOG.md describes what a prior agent INTENDED to change. Not what is actually in the code.
- Prior agent notes, session summaries, audit documents — all describe intent or observation. None of them are the code.
- Analysis based on a changelog is fabricated analysis. It cannot be trusted.

**The rule:**
- ANY claim about code behavior requires reading the actual file at the relevant line range.
- ANY categorization (real fix / band-aid) requires reading the actual code to verify the implementation matches the description.
- If you have not read the code: say "I have not read this code" — no analysis, no categorization, no assessment.

**What to do instead:**
1. List every file that would need to be read to support the analysis
2. Read those files (or relevant sections) with line numbers
3. Then produce the analysis grounded in what you actually read

**The test:** Can you cite a specific file, function, and line range for every claim you make? If no: you have not read the code and must not generate the analysis.
- Only change your position if they provide new information.

### Respond to problems with solutions
- Do NOT just acknowledge problems. Propose concrete solutions immediately.
- If you don't know the solution, research it.

### Think through pros and cons
- Before making any architectural decision, explicitly consider both sides.
- Present trade-offs. Let the user decide.

### Never ignore repeated requests
- If the user has asked for something more than once, it is mandatory.
- Do not selectively hear instructions.

### Be honest over helpful
- "There's nothing to do here" and "I don't know" are always acceptable.
- A short honest answer is better than a long fabricated one.

### Acknowledge every point
- If the user makes 7 points, respond to ALL 7. Not 4. Not 5. All 7.

---

## 11. NEVER STOP INVESTIGATING WITH OPEN UNKNOWNS

When investigating bugs:
- Close EVERY unknown before presenting a plan.
- "What I don't know" sections are WORK ITEMS, not disclaimers.
- If you list something you don't know, your next action is to go find out.
- You cannot present a fix plan while acknowledging unknowns.
- The ONLY acceptable reason to stop: every code path has been read and the remaining unknown requires runtime data.

---

## 12. BOTH SOURCE TREES — ALWAYS

Every code change goes to BOTH:
1. The primary source tree
2. The pipeline-clone mirror

If you change one file, you change its mirror. Always. No exceptions.

---

## 13. CHANGES_LOG.md — ALWAYS

Every code change must be logged:
- Date, file changed, line numbers, what was removed, what was added, why.
- Context windows expire. If it's not in CHANGES_LOG.md, it's lost.
- Before proposing any fix, read CHANGES_LOG.md first.

---

## 14. KEY TECHNICAL DECISIONS

### Solution A — Native Context Shift (the chosen architecture)
- Uses node-llama-cpp's built-in `contextShift.strategy` hook
- Custom strategy function in `nativeContextStrategy.js`
- When context fills, strategy compresses history intelligently:
  - Always keeps system prompt (first item)
  - Always keeps current model response (last item — truncated from beginning if needed)
  - Fills remaining budget with recent conversation turns
  - Summarizes dropped history
  - Verifies result fits within token budget before returning
- node-llama-cpp handles KV cache management — no manual session destruction
- Model CONTINUES generating from where it was after context shift — no restart

### What was removed (the old competing systems)
- `contextManager.js` — 4-phase progressive compaction at 35/50/65/80% thresholds. Destroyed the KV cache by resetting the session. REMOVED.
- Proactive rotation at 70% context usage. Preempted node-llama-cpp's native strategy. REMOVED from agenticLoop.js.
- Elaborate HEAD+TAIL continuation messages. Unnecessary because KV cache has full context after native shift. SIMPLIFIED in continuationHandler.js.
- `_compactHistory()` in llmEngine.js — simple 20% drop. SUPERSEDED by native strategy.

### Continuation handling (simplified)
When maxTokens hits during tool call:
- Save checkpoint to disk
- Minimal continuation message (last ~500 chars + "Continue")
- KV cache has full context — no HEAD+TAIL anchors needed

### Checkpoint protection
- Monotonic checkpoint: never overwrite file on disk with shorter content
- Rotation checkpoint: track what content has been written, prevent duplicates
- Overlap detection: when appending, compare leading lines against trailing lines of checkpoint

---

## 15. SUCCESS CRITERIA FOR FILE GENERATION (NON-NEGOTIABLE)

1. Context SHIFTS at least once (ideally multiple times)
2. File COMPLETES with closing tags (`</html>`, `</body>`, etc.)
3. ONE coherent code block in the UI (not multiple fragments)
4. Content is coherent across context shifts — model picks up where it left off
5. No model "giving up" — the pipeline drives the model to keep writing until done
6. Line count grows MONOTONICALLY — never drops, never restarts
7. No duplicate content at continuation or context shift boundaries
8. No raw JSON leaking into visible file content
9. No "undefined" or artifact text in the output

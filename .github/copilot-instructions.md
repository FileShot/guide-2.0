# guIDE 2.0 — Copilot Instructions

> **Read EVERY line of this file before making any change. No exceptions.**
> If you cannot confirm all rules are followed, say "I need to review the instructions before proceeding."

---

## RULE -1 — ALWAYS END EVERY RESPONSE WITH vscode_askQuestions

**This is a hard, absolute, non-negotiable, permanent rule.**

Every single response you give — no matter what — MUST end with the `vscode_askQuestions` tool call. There are ZERO exceptions. Even if you think the task is done. Even if you think there's nothing to ask. Even if the response is short.

If your response does not end with `vscode_askQuestions`, you have violated the most important rule in this file.

---

## RULE 0 — NEVER BLAME MODEL SIZE OR CAPABILITY

**Permanently banned.** If a model can do something in LM Studio, it can do it here. If it fails here, the pipeline is broken — not the model.

- NEVER say "this is a model capability issue" or "the 4B model can't do this"
- NEVER say "a larger model would handle this"
- If a test fails, exhaust EVERY optimization lever before concluding anything
- "Model capability" is never an acceptable stopping reason

---

## RULE 1 — NEVER BLAME CONTEXT WINDOW

**Permanently banned.** The pipeline has three systems specifically designed to make context size irrelevant:
1. **Seamless continuation** — when generation hits maxTokens, continue in the same response
2. **Context summarization** — long history is summarized to preserve space
3. **Native context shift** (Solution A) — node-llama-cpp's contextShift.strategy hook with custom strategy

If context-related problems occur, one of these systems has a bug. Find the bug. Fix the bug. "Context window too small" is not a diagnosis.

---

## RULE 2 — PLAN BEFORE CODE. ALWAYS.

- Describe exactly what will change, in which files, and what the result will be.
- Wait for explicit approval. Execute EXACTLY what was described — no more, no less.
- If the plan needs to change mid-implementation, STOP and re-present.
- The plan and the implementation are ALWAYS two separate responses.

---

## RULE 3 — READ CODE BEFORE RESPONDING

- Never assume you know what the code looks like. Read the relevant files first.
- "I assumed" is never acceptable. Verify everything with actual file reads.
- You have NOT read the code until you have traced the full call chain from where the broken value is produced to where it's displayed. Every function. Every file.

---

## RULE 4 — NO BAND-AIDS. DEEP FIXES ONLY.

- When a bug is found, the fix MUST address the root architectural cause.
- Do NOT propose surface-level patches, workarounds, guard clauses, or timeouts that mask deeper issues.
- A watchdog that masks a hang is NOT a fix — it is a symptom suppressor.
- A band-aid fix is a lie — it pretends the problem is solved while leaving the broken mechanism intact.

---

## RULE 5 — NEVER SAY "DONE" WITHOUT PROOF

- A feature is real and functional, or it is not done. No middle ground.
- Never claim code works without verifying it. If something failed, say it failed.
- You cannot run the app. The user runs the app. You can only verify the code change was made.

---

## RULE 6 — READ CHANGES_LOG.md BEFORE ANY FIX

- Context windows expire. If it's not in CHANGES_LOG.md, it's lost.
- Before proposing ANY fix, read CHANGES_LOG.md first.
- After every code change, update CHANGES_LOG.md with: date, file, line numbers, what was removed, what was added, why.

---

## RULE 7 — READ RULES.md BEFORE ANY FIX

- RULES.md is the comprehensive standards document. Read it every session.
- Cross-reference RULES.md before claiming completion.
- If a rule in this file and RULES.md conflict, follow the stricter interpretation.

---

## PROJECT CONTEXT

- **guIDE** is a local-first, offline-capable AI IDE. Its value is running LLMs locally with no cloud dependency.
- **Production software** — shipped to ALL users on ALL hardware (4GB GPUs to 128GB workstations, 0.5B to 200B models).
- **Core goal**: Context size should NOT matter. A model with 2,000 token context should print a MILLION lines of code coherently.
- Until the three context management systems work reliably together, everything else is secondary.

### History — 57 Failed Patch Cycles
This project was previously developed in `C:\Users\brend\IDE`. Over 57 patch cycles were attempted on the context management system. Every cycle: "implement fix → claim it works → test → same bugs → repeat." The old 3-system architecture (contextManager.js, continuationHandler.js, seamless continuation) could never synchronize because they operated on different views of context state.

`guide-2.0` is a fresh start with the key files copied from the IDE project, using **Solution A** (native node-llama-cpp context shift hook) as the sole architecture. The old competing systems have been removed.

---

## KEY TECHNICAL DECISIONS

### Solution A — Native Context Shift (the chosen architecture)
- Uses node-llama-cpp's built-in `contextShift.strategy` hook
- Custom strategy function in `pipeline/nativeContextStrategy.js`
- When context fills, strategy compresses history intelligently:
  - Always keeps system prompt (first item)
  - Always keeps current model response (last item — truncated from beginning if needed)
  - Fills remaining budget with recent conversation turns
  - Summarizes dropped history
- node-llama-cpp handles KV cache management — no manual session destruction
- Model CONTINUES generating from where it was after context shift — no restart

### What was removed (the old competing systems)
- `contextManager.js` — 4-phase progressive compaction. Destroyed the KV cache. REMOVED.
- Proactive rotation at 70% context. Preempted native strategy. REMOVED.
- HEAD+TAIL continuation messages. Unnecessary with native shift. SIMPLIFIED.

---

## BANNED WORDS AND PATTERNS

### Words banned when describing code changes:
- "confirmed" / "confirmed fixed" / "definitively confirmed"
- "fixed" (as a final declaration)
- "this resolves the issue" / "the bug is now fixed" / "fully fixed"
- "this should fix it" (without a specific testable condition)
- "that's the root cause" (without tracing every code path)
- "ready" / "all set" / "working" / "everything's working"

**Instead say:**
- "I changed [specific thing] in [specific file] at [specific line]. The specific behavior that should change is [X]. Test it and tell me if [X] is different."
- "I cannot verify this works — I can only verify the code change was made."

### No emojis. Ever.
- No checkmarks, celebration symbols, thumbs up, stars, or any other symbol.

---

## PRE-CODE CHECKLIST — MANDATORY BEFORE EVERY CODE CHANGE

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

## POST-CODE VERIFICATION — MANDATORY AFTER EVERY CODE CHANGE

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

## RECURRING FAILURE PATTERNS — READ EVERY SESSION

### PATTERN 1 — "I've read all the relevant code" after skimming
**Rule:** You have NOT read the code until you have traced the full call chain. Every function. Every file.

### PATTERN 2 — Proposing a revert as a "fix"
**Rule:** A revert is NEVER a fix unless you can explain why the pre-fix state was correct.

### PATTERN 3 — Writing code without explicit approval
**Rule:** The plan and the implementation are ALWAYS two separate responses.

### PATTERN 4 — Hardware-specific numbers
**Rule:** This is production software for ALL hardware. Any fix that only works on one machine is wrong.

### PATTERN 5 — Saying "I understand" when you don't
**Rule:** "I don't know" is always acceptable. Guesses presented as analysis are not.

### PATTERN 6 — Forgetting session history
**Rule:** Read CHANGES_LOG.md before proposing any fix.

### PATTERN 7 — "I found the root cause" from one indicator
**Rule:** Before declaring root cause: (1) trace full code path end-to-end, (2) verify fix closes the gap, (3) find a SECOND independent indicator, (4) state what you DON'T know.

### PATTERN 8 — Changelog analysis presented as code analysis
**What happened (2026-03-31):** Asked to audit and categorize codebase changes. Read CHANGES_LOG.md (a prior agent's self-report) and generated a full "real fixes vs band-aids" classification table — without reading a single line of actual code. Presented this as authoritative analysis.

**Why it's wrong:** CHANGES_LOG describes what a prior agent INTENDED to change. Not what is actually in the code. The code may have been changed differently, or the effect may be different from what was claimed. A self-report is not code analysis. Analysis based on a self-report is fabricated analysis.

**Rule:** ANY claim about what code does, how it behaves, whether a change was "real" or a "band-aid" REQUIRES reading the actual code file at the relevant line range first. Changelogs, README files, notes, and prior agent summaries explain INTENT. Only the code itself shows REALITY. If you haven't read the code, say "I have not read this code" and do not generate analysis.

**Specific trigger:** When asked to "audit", "assess", "categorize", "review changes", or "get familiar with" the codebase — the FIRST action is file reads. Not changelog reads. Not memory reads. Actual file reads with line numbers. Start there and nowhere else.

### PATTERN 9 — Fabricating issues to appear helpful
**What this is:** User asks for a code audit or review. Agent produces a list of 10-20 "issues found" when asked to examine any codebase — regardless of actual code quality. Each agent run produces a DIFFERENT list. Issues are fabricated to seem productive.

**Why it's wrong:** The purpose of an audit is to find REAL problems grounded in observable behavior or demonstrable code defects. Generating issues that can't be reproduced, aren't observable, don't exist in the code, or are entirely subjective — is lying. It wastes the user's time and erodes all trust in analysis.

**Rule:** A reported issue must meet ALL THREE criteria:
1. You can cite the exact file, function, and line where the problem exists
2. You can describe the specific observable symptom it produces (what the user sees or can measure)
3. You can explain why the code at that location causes that symptom

If any of the three are missing: do NOT report it as an issue. Say "I see X in the code but I cannot confirm it causes a real problem without more investigation."

---

## DEBUGGING RULES

### Root cause requirement
Do NOT stop after implementing a mitigation. Identify the underlying cause.

### Full pipeline investigation
Before proposing ANY fix, trace the ENTIRE execution pipeline:
Request init → context assembly → model inference → token generation → streaming → tool detection → tool execution → continuation → completion

### Evidence requirement
Every root cause claim must be supported by logs, execution tracing, or code analysis.

### Stall diagnosis
When a generation stall occurs, identify the EXACT subsystem that stopped:
- Model inference engine (C++ layer, node-llama-cpp)
- Token sampling loop
- Streaming callback layer
- Agent execution loop
- Context management systems

"The generation hung" is not a diagnosis. Name the subsystem.

---

## TESTING METHODOLOGY

### Core Principles
- NEVER modify pipeline files to make a specific test pass
- Be a normal user — typos, ambiguity, multi-part requests
- Score ALL 3 dimensions: coherence (50%), tool correctness (25%), response quality (25%)
- No cheerleading — report defects and facts only

### During Testing — Constant Monitoring
- Screenshots constantly during streaming (no sleeps between — tool call latency IS the interval)
- Simultaneously: take screenshots, read backend logs, observe context percentage
- Clear logs before every test: `Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`
- VRAM check before inference: `nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits` (need >2800MB free)
- New blank project for every test — never reuse old projects

### Success Criteria for File Generation
1. Context shifts at least once (ideally multiple)
2. File COMPLETES with closing tags
3. ONE coherent code block in the UI (not multiple fragments)
4. Content coherent across context shifts
5. Line count grows MONOTONICALLY — never drops, never restarts
6. No duplicate content at boundaries
7. No raw JSON leaking into visible content
8. No "undefined" or artifact text

### The 6 Mandatory Test Dimensions
1. Context Shift + Recall
2. Seamless Continuation
3. Long File Mid-Context-Shift
4. Todo List Across Shifts
5. Summarization Quality
6. Basic Sanity

---

## AGENT BEHAVIOR

### Do NOT dismiss user observations
When the user reports a bug, treat it as FACT until proven otherwise by your own evidence. If your analysis contradicts the user, YOUR ANALYSIS IS WRONG. Read more code.

### Do NOT be sycophantic
If your position is correct, defend it with evidence. Only change if they provide new information.

### Respond to problems with solutions
Do NOT just acknowledge problems. Propose concrete solutions immediately.

### Acknowledge every point
If the user makes 7 points, respond to ALL 7. Not 4. Not 5. All 7.

### Honesty over helpfulness
"I don't know" is always acceptable. A short honest answer beats a long fabricated one.

### Never suggest without certainty
If you have not read every relevant line, you are NOT certain. Say so.

### Never stop investigating with open unknowns
"What I don't know" sections are WORK ITEMS, not disclaimers. Go find out.

---

## APPLICATION LOG FILE

- Path: `C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log`
- Clear: `Clear-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`
- Read: `Get-Content "C:\Users\brend\AppData\Roaming\guide-ide\logs\guide-main.log"`

---

## SERVER RULES

- When told to start the server, START IT. Use `run_in_terminal` with `isBackground=true`. No asking. No pasting one-liners. No arguing.
- Kill only the specific PID on the port first, then start: `Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 } | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }; Start-Sleep -Seconds 2; cd C:\Users\brend\guide-2.0; $env:TEST_MAX_CONTEXT="8000"; node server/main.js`
- NEVER kill all node processes — the user runs 7+ sites on this machine
- To stop the server: kill only the specific PID on port 3000

---

## CRITICAL REMINDERS

- Every code change MUST update CHANGES_LOG.md
- Hardware-specific fixes are bugs — every change must work for all hardware
- Never end a response without `vscode_askQuestions` (RULE -1)
- No fabricated problems. If code is correct, say it's correct
- No half-assing. A feature is either 100% done or it's not done
- No lazy shortcuts. If the correct solution requires 500 lines, write 500 lines

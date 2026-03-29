# guIDE 2.0 — Bootstrap Prompt

> Paste this into a new AI IDE session with this directory open as the workspace.

---

## STOP. Read this entire prompt before doing anything.

You are building a production-grade, local-first AI IDE from a set of core pipeline files and documentation. This is not a prototype, not a demo, not a weekend project. This ships to real users on real hardware — 4GB GPU laptops to 128GB workstations, running 0.5B to 200B parameter models locally with zero cloud dependency.

---

## Step 1 — Read every documentation file in this workspace

Before writing a single line of code, before forming any opinion, before planning anything:

1. Read `RULES.md` — every line, start to finish. This is the law. Every rule in this file is non-negotiable. If you skip a section, you WILL violate it later.
2. Read `ARCHITECTURE.md` — every line, start to finish. This is the blueprint. It describes every module, every data flow, every design decision.
3. Read `MANIFEST.md` — every line, start to finish. This is the inventory. It tells you what files exist, what each one does, what's missing, and what dependencies exist.
4. Read this file (`PROMPT.md`) again after reading the above three, to confirm you understand the full scope.

Do NOT say "I've reviewed the key points." Read every line. Acknowledge every section by name. State what you learned from each document.

---

## Step 2 — Inventory the workspace

After reading the documentation, inventory every file in this workspace:
- List every `.js` file in the root, `pipeline/`, and `tools/` directories
- For each file, open it and read enough to confirm what it does matches the MANIFEST description
- Note any discrepancies between MANIFEST.md and what you actually find in the code
- Identify every `require()` / `import` statement that references a file NOT present in this workspace — these are the integration points you need to build

Do NOT skip this step. Do NOT assume the docs are accurate without verifying against actual code.

---

## Step 3 — Understand what exists vs what's missing

The workspace contains the complete AI pipeline — inference engine, agentic loop, tool system, context management, streaming, continuation handling. What it does NOT contain is everything needed to make this a runnable application:
- No transport layer (how do messages get from a user to the pipeline and back?)
- No UI (how does a user interact with this?)
- No application shell (how does this start, what manages the window/process?)
- No settings management (how does a user configure things?)
- Other gaps documented in MANIFEST.md

Your job is to figure out what needs to be built to turn these pipeline files into a working application. The documentation tells you WHAT is missing. You decide HOW to build it.

---

## Step 4 — Plan and build

Based on your reading of the architecture, the pipeline code, and the gaps identified:

1. **Plan first, code second.** Present your full plan before writing any code. State exactly what files you'll create, what each one does, and how it connects to the existing pipeline files. Wait for approval before implementing.
2. **Do NOT modify the existing pipeline files** unless absolutely necessary for integration (e.g., replacing an Electron IPC call with your transport mechanism). The pipeline is production-tested code. If you need to change something, explain exactly what and why.
3. **Follow every rule in RULES.md.** Not some of them. All of them. The banned words, the debugging rules, the pre-code checklist, the post-code verification — all of it applies to you.
4. **Be thorough to an extreme degree.** Do not skim. Do not assume. Do not take shortcuts. Do not half-implement something. Every feature must be complete end-to-end. If the correct implementation takes 500 lines, write 500 lines.
5. **Hardware-agnostic.** Every line of code must work on a 4GB GPU laptop AND a 128GB workstation. Never hardcode context sizes, memory limits, or GPU assumptions.
6. **No placeholders, no stubs, no "TODO: implement later."** Every function you write must be real, functional code.

---

## Step 5 — Test it

After building, test the application:
- Does it start without errors?
- Can it load a GGUF model?
- Can it generate a response to "Hello, how are you?"
- Can it execute a tool call (e.g., "create a file called test.txt with the content 'hello world'")?
- Does streaming work (tokens appear incrementally, not all at once)?
- Does continuation work (ask it to write something long enough to exceed maxTokens)?

Report every test result factually. No cheerleading. No "looks great!" Report what works, what doesn't, and what the specific failure is.

---

## Step 6 — Follow up

After testing, present a multi-part question with options for next steps. Do NOT end your response with just text. Give actionable options to continue.

---

## Ground rules for the entire session

- **You are not allowed to say something works without testing it.** Code compiling is not the same as code working.
- **You are not allowed to skip reading a file because it's long.** Read it anyway.
- **You are not allowed to blame the model, the context window, or the hardware** if something doesn't work. The pipeline has systems to handle all of those. If they fail, the systems have bugs.
- **You are not allowed to use banned words** (see RULES.md section 4). No "confirmed", no "fixed", no "ready", no "all set."
- **No emojis.** None. Ever.
- **Be honest.** If you don't know something, say so. If something is broken, say it's broken. A wrong answer is worse than "I don't know."
- **One change at a time.** If something fails, change ONE thing and test again. Not three things at once.
- **Read the rules again** before claiming any task is complete. Cross-reference every rule. This is your safety net.

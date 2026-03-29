# guIDE 2.0 — Pipeline Architecture

> Technical architecture of the guIDE AI pipeline. This document describes how the system works,
> what each layer does, and how they interact. This is the blueprint for rebuilding the application.

---

## 1. HIGH-LEVEL ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                        TRANSPORT LAYER                          │
│              (Electron IPC / WebSocket / HTTP)                  │
│         Receives user messages, sends streaming tokens          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      agenticChat.js                             │
│            Entry point — session management                     │
│     Creates LLM engine, manages conversations, routes IPC      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      llmEngine.js                               │
│           Model loading, inference, context management          │
│  Loads GGUF models via node-llama-cpp, manages sessions/ctx     │
│  Owns the LlamaContext and LlamaChatSession objects             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────────────┐
              ▼             ▼                     ▼
┌──────────────────┐ ┌──────────────┐ ┌────────────────────────┐
│  agenticLoop.js  │ │ streamHandler│ │ nativeContextStrategy  │
│  The brain —     │ │  .js         │ │  .js                   │
│  iterates tool   │ │  Streaming   │ │  Context shift         │
│  calls, drives   │ │  token       │ │  strategy for          │
│  continuation    │ │  delivery    │ │  node-llama-cpp        │
└──────┬───────────┘ └──────┬───────┘ └────────────────────────┘
       │                    │
       ▼                    ▼
┌──────────────────┐ ┌──────────────────┐
│  mcpToolServer   │ │  responseParser  │
│  .js             │ │  .js             │
│  Tool registry   │ │  Parse tool      │
│  + execution     │ │  calls from      │
│                  │ │  model output    │
└──────────────────┘ └──────────────────┘
```

---

## 2. REQUEST LIFECYCLE

### Phase 1: User sends a message
1. Transport layer receives user message
2. `agenticChat.js` receives it, appends to conversation history
3. Calls `llmEngine.generateResponse()` with the full conversation

### Phase 2: Context assembly
1. `promptAssembler.js` builds the full prompt:
   - System preamble (from `constants.js`, sized by model tier)
   - Project context (open files, project facts)
   - Conversation history (possibly summarized by `conversationSummarizer.js`)
   - User's current message
2. `llmEngine.js` creates/reuses a `LlamaChatSession` with the assembled messages

### Phase 3: Model inference
1. `llmEngine.js` calls `session.prompt()` or `session.chat()` on node-llama-cpp
2. Tokens stream back via callback
3. `streamHandler.js` processes each token:
   - Detects file content blocks (```language markers)
   - Routes tokens to the UI via transport layer
   - Manages file streaming state (filename, content accumulation)

### Phase 4: Tool detection and execution
1. As tokens accumulate, `responseParser.js` checks for tool call patterns
2. When a complete tool call is detected:
   - `agenticLoop.js` extracts the tool name and arguments
   - `mcpToolServer.js` validates and executes the tool
   - Tool result is injected into the conversation
   - Loop continues — model sees the tool result and generates more

### Phase 5: Continuation (seamless)
1. When generation hits `maxResponseTokens`:
   - `agenticLoop.js` detects this is NOT a natural stop
   - `continuationHandler.js` builds a continuation message
   - The model continues generating from where it left off
   - From the user's perspective, it's one continuous response

### Phase 6: Context shift (when context fills)
1. node-llama-cpp detects context is full during inference
2. Calls the custom strategy function in `nativeContextStrategy.js`
3. Strategy receives the full token sequence and must return a shorter one:
   - Keeps system prompt (always)
   - Keeps current model output (always — truncated from the beginning if needed)
   - Fills remaining budget with recent conversation turns
   - Summarizes dropped turns via `rollingSummary.js`
4. node-llama-cpp handles KV cache re-evaluation
5. Model CONTINUES generating — no restart, no new session

### Phase 7: Completion
1. Model emits EOS token (natural stop)
2. `agenticLoop.js` checks if there are pending tool calls
3. If yes → execute tools, continue loop
4. If no → finalize response, send to UI

---

## 3. CORE MODULES — DETAILED

### agenticChat.js
**Role:** Top-level orchestrator. Entry point for all chat interactions.
- Manages conversation sessions (create, switch, delete)
- Initializes the LLM engine and tool server
- Routes messages between transport layer and engine
- Owns the conversation history array
- Delegates actual generation to `llmEngine.js` and the agentic loop

### llmEngine.js
**Role:** Model management and inference.
- Loads GGUF models via node-llama-cpp's `LlamaModel`
- Creates `LlamaContext` with appropriate size (computed from available RAM/VRAM)
- Creates `LlamaChatSession` for conversational inference
- Manages GPU layer allocation (auto-detected or manual)
- Handles model switching (unload old, load new)
- Registers the native context shift strategy from `nativeContextStrategy.js`
- Exposes `generateResponse()` which the agentic loop calls

### agenticLoop.js (pipeline/agenticLoop.js)
**Role:** The brain of the system. Iterates tool calls and continuations.
- Main loop: generate → check for tool calls → execute tools → inject results → generate again
- Handles seamless continuation when maxTokens is hit
- Manages checkpoints (monotonic + rotation) for file integrity
- Overlap detection for append operations
- Salvage recovery when JSON tool wrappers are malformed
- Drives the model to completion — never lets it give up mid-file

**Key mechanisms:**
- **Monotonic checkpoint:** When model writes a file, checkpoint the content. Never allow a subsequent write to the SAME file to be shorter than the checkpoint. This prevents content regression.
- **Rotation checkpoint:** Track what content has been written across context shifts. When the model wants to append after a context shift, compare against what's already on disk to prevent duplicates.
- **Salvage:** When the model's tool call JSON is malformed but content is extractable, salvage the content and continue. This is critical for small models that sometimes produce imperfect JSON.
- **Continuation decision:** When generation stops (maxTokens or natural stop), decide: is the file complete? If yes → finalize. If no → continue with a directive.

### streamHandler.js (pipeline/streamHandler.js)
**Role:** Processes streaming tokens and delivers them to the UI.
- Receives individual tokens from the inference engine
- Detects file content blocks (triple-backtick markers with filename)
- Routes tokens as either "text" (chat response) or "file content" (code being written)
- Manages streaming state: which file is being written, accumulated content
- Holdback buffer to prevent JSON wrapper artifacts from leaking into file content
- Sends events to the transport layer (Electron IPC, WebSocket, etc.)

### responseParser.js (pipeline/responseParser.js)
**Role:** Parses model output to extract tool calls.
- Detects various tool call formats the model might produce
- Extracts tool name, arguments, and content from the model's raw text
- Handles edge cases: multiple tool calls in one response, partial JSON, nested content

### nativeContextStrategy.js (pipeline/nativeContextStrategy.js)
**Role:** Custom context shift strategy for node-llama-cpp.
- Registered with `LlamaContext` as the `contextShift.strategy` callback
- Called by node-llama-cpp when context is full during inference
- Receives the full token sequence and a target length
- Returns a compressed sequence that fits within budget:
  1. Always preserves system prompt tokens (first message)
  2. Always preserves current model output tokens (last message — truncated from beginning if too long)
  3. Fills remaining space with most recent conversation turns
  4. Drops oldest turns first
  5. Triggers async summarization of dropped content via `rollingSummary.js`
- Must return a sequence that fits EXACTLY within the budget — node-llama-cpp will reject it otherwise

### rollingSummary.js (pipeline/rollingSummary.js)
**Role:** Maintains a rolling summary of conversation history.
- When context shift drops old turns, their content is summarized
- Summary persists across context shifts — it accumulates
- Used by `promptAssembler.js` to include historical context without full conversation
- Summary includes: what the user asked for, what files were created, what decisions were made, current state

### conversationSummarizer.js (pipeline/conversationSummarizer.js)
**Role:** Summarizes conversation history for context management.
- Called when conversation history exceeds context budget
- Produces a compact summary of older messages
- Preserves key facts: task description, files modified, decisions made
- Different from rollingSummary: this operates on the message array level, rollingSummary operates at the token level during context shift

### promptAssembler.js (pipeline/promptAssembler.js)
**Role:** Assembles the complete prompt from components.
- Combines: system preamble + project context + conversation history + rolling summary + current message
- Respects context budget — trims/summarizes to fit
- Applied different preambles based on model tier (compact for small models, full for large)

### continuationHandler.js (pipeline/continuationHandler.js)
**Role:** Manages seamless continuation when generation hits maxTokens.
- Builds the continuation message injected into the conversation
- Simplified design: includes last ~500 chars of model output + "Continue" directive
- No elaborate HEAD+TAIL anchors — the KV cache has full context after native shift
- Tracks continuation count to prevent infinite loops

### mcpToolServer.js
**Role:** Tool registry and execution engine.
- Defines all available tools (read_file, write_file, append_to_file, list_directory, run_command, web_search, etc.)
- Each tool has: name, description, parameter schema, execute function
- Tool descriptions are critical — they're what the model reads to decide WHEN to use each tool
- Validates tool arguments before execution
- Returns structured results that get injected into the conversation

### constants.js
**Role:** System-wide constants and preamble text.
- `DEFAULT_SYSTEM_PREAMBLE` — full system prompt for medium/large models
- `DEFAULT_COMPACT_PREAMBLE` — shortened system prompt for small models (< 4B params)
- Max token limits, continuation thresholds, context budget percentages
- These are the primary tuning knobs for model behavior

### modelProfiles.js
**Role:** Per-model-family configuration.
- Sampling parameters per model tier: temperature, topP, topK, repeatPenalty
- Few-shot example counts
- Grammar constraint flags
- Model family detection patterns (qwen, llama, mistral, gemma, etc.)
- Tier classification (small < 4B, medium 4-14B, large > 14B)

### modelDetection.js
**Role:** Identifies model family and capabilities from GGUF metadata.
- Reads GGUF file headers
- Extracts: model family, parameter count, quantization level, context length
- Determines GPU layer allocation based on available VRAM
- Used by `llmEngine.js` during model loading

---

## 4. CONTEXT MANAGEMENT — SOLUTION A (THE CHOSEN DESIGN)

### The Problem (What Was Wrong Before)
The old system (`contextManager.js`) used proactive rotation at fixed thresholds (35%, 50%, 65%, 80% context usage). When triggered, it:
1. Destroyed the entire LlamaChatSession
2. Created a new session with summarized history
3. The model had to restart from scratch with no KV cache continuity

This was catastrophic for file generation:
- Model lost all in-progress work
- KV cache was destroyed — model couldn't remember what it was writing
- File content regressed (restarted from line 1)
- Generated duplicate content

### Solution A — Native Context Shift
node-llama-cpp has a BUILT-IN mechanism for handling context overflow. When the context fills during inference, it calls a `contextShift.strategy` function. This is a hook we control.

**How it works:**
1. Model is generating tokens. Context fills up.
2. node-llama-cpp pauses inference and calls our strategy function.
3. Our function receives the full token sequence and a target size.
4. We return a SHORTER sequence (dropping old conversation, keeping system prompt + current output).
5. node-llama-cpp re-evaluates the KV cache with the shorter sequence.
6. Model CONTINUES generating from where it was — no restart, no new session.

**Why this is correct:**
- KV cache continuity — the model never loses its current generation state
- No session destruction — the session object stays alive
- Intelligent compression — we choose what to keep vs drop
- Model doesn't know it happened — from its perspective, generation is continuous

### Important Implementation Details
- The strategy function receives token IDs (numbers), not text. It must operate on token-level boundaries.
- System prompt tokens must ALWAYS be preserved (they're at the beginning of the sequence).
- Current model output tokens must ALWAYS be preserved (they're at the end).
- Middle conversation turns are the ones that get dropped.
- The async summary of dropped content happens AFTER the strategy returns — it doesn't block inference.
- The strategy MUST return a sequence that fits within the target size. If it doesn't, node-llama-cpp will throw.

### Qwen3.5 SSM/Mamba Architecture Note
For Qwen3.5 models (SSM/Mamba hybrid), node-llama-cpp's binary-search context estimator inflates KV cache requirements by 100x because it uses `trainContextSize=262144` as the base. This causes the `{min, max}` range-based context selection to return near-minimum context even on 32GB RAM machines.

**The fix:** Always use explicit computed context size + `ignoreMemorySafetyChecks: true` + `failedCreationRemedy: { retries: 8, autoContextSizeShrink: 0.5 }` so actual hardware capacity drives the result, not the binary-search estimator.

---

## 5. STREAMING PIPELINE — TOKEN TO SCREEN

```
node-llama-cpp inference
    │
    │ token callback (individual tokens)
    ▼
streamHandler.js
    │
    ├── Detects file blocks (```)
    ├── Routes: text vs file content
    ├── Holdback buffer (last 3 chars withheld to strip JSON artifacts)
    │
    │ IPC/WebSocket events
    ▼
Transport Layer (to be implemented per platform)
    │
    ▼
UI Rendering (to be implemented)
    │
    ├── Accumulates streamed tokens
    ├── Renders markdown
    ├── Renders code blocks with syntax highlighting
    └── Shows file operations (create/append/etc.)
```

### Stream Events (emitted by streamHandler.js)
- `chat:text` — regular text token (markdown, explanation, etc.)
- `chat:fileStart` — beginning of a file content block (includes filename, language)
- `chat:fileContent` — file content token (code being written)
- `chat:fileEnd` — end of file content block
- `chat:toolCall` — tool call detected
- `chat:toolResult` — tool execution result
- `chat:done` — generation complete

---

## 6. TOOL EXECUTION FLOW

```
Model outputs: "I'll create the file now.\n<tool_call>write_file({...})</tool_call>"
    │
    ▼
responseParser.js extracts tool call
    │
    ▼
agenticLoop.js receives parsed tool
    │
    ├── Validates tool name exists in registry
    ├── Checks for overlap (append operations)
    ├── Updates checkpoints
    │
    ▼
mcpToolServer.js executes tool
    │
    ├── Validates arguments against schema
    ├── Runs the tool function
    ├── Returns structured result
    │
    ▼
agenticLoop.js injects result into conversation
    │
    ▼
Model sees: "[Tool result: file written successfully]"
    │
    ▼
Model continues generating (next tool call or final response)
```

---

## 7. CONTINUATION FLOW (SEAMLESS)

```
Model hits maxResponseTokens (e.g., 4096 tokens generated)
    │
    ▼
agenticLoop.js detects: stop reason = maxTokens (not EOS)
    │
    ├── Is the model mid-file? Check streamHandler state
    ├── Is the file structurally complete? Check content for closing tags
    │
    ▼
continuationHandler.js builds continuation message:
    "...last 500 chars of output...\nContinue from where you left off."
    │
    ▼
Message injected into conversation history
    │
    ▼
llmEngine.js starts new generation call
    │
    ▼
Model continues writing from where it stopped
    │
    ▼
streamHandler.js stitches output seamlessly
    (no duplicate content, no gap, no visible seam)
```

---

## 8. CONTEXT SHIFT FLOW (NATIVE)

```
Model generating tokens... context reaches capacity
    │
    ▼
node-llama-cpp pauses inference
    │
    ▼
Calls nativeContextStrategy.js strategy function
    │
    ├── Receives: full token sequence, target size
    ├── Identifies: system prompt range, conversation ranges, current output range
    │
    ▼
Strategy builds compressed sequence:
    [system prompt tokens] + [recent conversation tokens] + [current output tokens]
    │
    ├── Drops oldest conversation turns to fit budget
    ├── Triggers async summarization of dropped content
    │
    ▼
Returns compressed sequence to node-llama-cpp
    │
    ▼
node-llama-cpp re-evaluates KV cache
    │
    ▼
Model CONTINUES generating (no restart, no new session)
    │
    ▼
User sees: uninterrupted output, as if nothing happened
```

---

## 9. FILES NOT INCLUDED (AND WHY)

The following components are needed for a complete application but are NOT included in the core pipeline files. They must be rebuilt or replaced.

### Transport Layer
The pipeline currently uses Electron IPC (`mainWindow.webContents.send()`) to deliver streaming tokens to the UI. For a rebuild, this needs to be replaced with whatever transport is appropriate (WebSocket, HTTP SSE, direct function calls, etc.). The touch points are:
- `streamHandler.js` — the `_send()` method
- `agenticChat.js` — IPC handler registration

### UI Layer
No frontend code is included. The pipeline produces streaming events (text tokens, file operations, tool calls). A UI must be built to consume these events and render them.

### Electron Shell
No Electron-specific code is included (app lifecycle, window management, menus, dialogs). The pipeline is pure Node.js and can run in any environment that provides node-llama-cpp.

### Context Manager (OLD — intentionally excluded)
`contextManager.js` was the old competing context management system. It used proactive rotation with session destruction. It has been replaced by Solution A (native context shift via `nativeContextStrategy.js`). Do NOT rebuild it. Do NOT port it.

### Cloud Services
No cloud API integration is included (API key management, cloud LLM services). guIDE is local-first.

### Image Generation
Image generation services are not included. They are supplementary features, not core pipeline.

### Git Integration
Git tools (`mcpGitTools.js`) are included as a tool, but the full git management layer (`gitManager.js`) is not. The tool is sufficient for model-driven git operations.

### Browser Automation
Browser tools (`mcpBrowserTools.js`) are included as a tool, but the Playwright browser manager is not. The tool provides the interface; the browser engine can be implemented per platform.

### Terminal Management
No terminal emulation or management is included. The pipeline can execute commands via tools, but the terminal UI must be rebuilt.

### RAG Engine
The retrieval-augmented generation engine is not included. It's a supplementary feature.

### Settings Management
No settings UI or persistence is included beyond what the pipeline files handle internally.

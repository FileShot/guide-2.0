# guIDE 2.0 — File Manifest

> Complete inventory of every file in the guide-2.0 directory.
> Each file has a description, its role in the pipeline, and its key dependencies.

---

## Directory Structure

```
guide-2.0/
├── RULES.md                          # Consolidated rules, standards, expectations
├── ARCHITECTURE.md                   # Technical architecture and design documentation
├── MANIFEST.md                       # This file — inventory and descriptions
├── pipeline/
│   ├── agenticLoop.js                # Core agentic loop — tool iteration + continuation
│   ├── streamHandler.js              # Token streaming and file content detection
│   ├── responseParser.js             # Tool call extraction from model output
│   ├── nativeContextStrategy.js      # Context shift strategy for node-llama-cpp
│   ├── rollingSummary.js             # Rolling summary of dropped conversation history
│   ├── conversationSummarizer.js     # Conversation history summarization
│   ├── promptAssembler.js            # Full prompt assembly from components
│   └── continuationHandler.js        # Seamless continuation message builder
├── tools/
│   ├── mcpBrowserTools.js            # Browser automation tool definitions
│   ├── mcpGitTools.js                # Git operation tool definitions
│   └── toolParser.js                 # Tool call parsing utilities
├── agenticChat.js                    # Top-level chat orchestrator
├── agenticChatHelpers.js             # Helper functions for agenticChat
├── constants.js                      # System preambles and configuration constants
├── llmEngine.js                      # Model loading, inference, session management
├── logger.js                         # Logging utility
├── longTermMemory.js                 # Long-term memory persistence
├── mcpToolServer.js                  # Tool registry, validation, and execution
├── memoryStore.js                    # In-memory key-value store
├── modelDetection.js                 # GGUF metadata reading and model identification
├── modelManager.js                   # Model lifecycle management
├── modelProfiles.js                  # Per-model-family sampling and config profiles
├── pathValidator.js                  # Path validation and sanitization
├── sanitize.js                       # Input/output sanitization utilities
├── sessionStore.js                   # Session state persistence
└── (no contextManager.js — intentionally excluded, see notes)
```

---

## File Descriptions

### Documentation

| File | Description |
|------|-------------|
| `RULES.md` | All rules, standards, quality expectations, testing methodology, agent behavior rules. Consolidated from multiple source documents. The single source of truth for how to work on this project. |
| `ARCHITECTURE.md` | Technical architecture — request lifecycle, module descriptions, context management (Solution A), streaming pipeline, tool execution flow, continuation flow, context shift flow. |
| `MANIFEST.md` | This file. Complete inventory of included files with descriptions and dependency notes. Lists what's missing and needs to be rebuilt. |

### Pipeline Core (`pipeline/`)

| File | Role | Key Dependencies |
|------|------|-----------------|
| `agenticLoop.js` | **The brain.** Main iteration loop: generate → detect tool calls → execute → inject result → generate again. Handles seamless continuation, checkpoint management (monotonic + rotation), overlap detection for appends, salvage recovery for malformed JSON. | streamHandler, responseParser, mcpToolServer, continuationHandler, constants |
| `streamHandler.js` | **Token routing.** Processes individual tokens from inference. Detects file content blocks (triple-backtick markers). Routes tokens as "text" or "file content" events. Manages holdback buffer to strip JSON artifacts. | Transport layer (currently Electron IPC — needs replacement) |
| `responseParser.js` | **Tool extraction.** Parses model output to find tool call patterns. Extracts tool name, arguments, and content. Handles multiple formats and edge cases (partial JSON, nested content). | None (pure parsing) |
| `nativeContextStrategy.js` | **Context shift handler.** Custom strategy registered with node-llama-cpp's `contextShift.strategy` hook. When context fills, compresses the token sequence: keeps system prompt + current output, drops oldest conversation, triggers async summarization. | rollingSummary, node-llama-cpp |
| `rollingSummary.js` | **History compression.** Maintains a running summary of conversation history dropped during context shifts. Summary accumulates across shifts. Included in subsequent prompts to preserve historical context. | LLM inference (uses the loaded model to generate summaries) |
| `conversationSummarizer.js` | **Message-level summarization.** Summarizes conversation history when it exceeds context budget. Operates on the message array (not token-level like rollingSummary). Preserves key facts: task description, files modified, decisions. | LLM inference |
| `promptAssembler.js` | **Prompt builder.** Combines system preamble + project context + conversation history + rolling summary + current message into the final prompt. Respects context budget. Selects preamble by model tier. | constants, rollingSummary, conversationSummarizer |
| `continuationHandler.js` | **Continuation builder.** When generation hits maxTokens, builds the continuation message injected into conversation. Simplified design: last ~500 chars + "Continue" directive. Tracks continuation count. | None (pure message construction) |

### Engine & Configuration (root)

| File | Role | Key Dependencies |
|------|------|-----------------|
| `agenticChat.js` | **Entry point.** Top-level orchestrator. Manages conversation sessions. Routes messages between transport and engine. Initializes LLM engine and tool server. | llmEngine, agenticChatHelpers, agenticLoop |
| `agenticChatHelpers.js` | **Helper utilities.** Shared helper functions used by agenticChat. Conversation formatting, message manipulation, history management. | None (utility functions) |
| `llmEngine.js` | **Model management.** Loads GGUF models via node-llama-cpp. Creates LlamaContext and LlamaChatSession. Manages GPU layers. Registers context shift strategy. Exposes `generateResponse()`. | node-llama-cpp, modelProfiles, modelDetection, nativeContextStrategy, constants, logger |
| `constants.js` | **Configuration hub.** System preambles (`DEFAULT_SYSTEM_PREAMBLE`, `DEFAULT_COMPACT_PREAMBLE`), max token limits, context thresholds. Primary tuning point for model behavior. | None (constants only) |
| `modelProfiles.js` | **Model configs.** Per-model-family sampling parameters (temperature, topP, topK, repeatPenalty), few-shot example counts, grammar flags, tier classification (small/medium/large). | None (configuration data) |
| `mcpToolServer.js` | **Tool engine.** Defines all available tools with names, descriptions, parameter schemas, and execute functions. Tool descriptions are what the model reads to decide when to use tools. Validates arguments. | pathValidator, fs, child_process |
| `modelDetection.js` | **Model identification.** Reads GGUF file headers. Extracts model family, parameter count, quantization, context length. Determines GPU layer allocation from VRAM. | fs (GGUF binary reading) |
| `modelManager.js` | **Model lifecycle.** Higher-level model management — loading, unloading, switching between models. Model discovery from filesystem. | llmEngine, modelDetection |
| `logger.js` | **Logging.** Structured logging utility. Writes to log file. Levels: debug, info, warn, error. | fs (log file writing) |
| `sanitize.js` | **Sanitization.** Input/output sanitization. Prevents path traversal, strips dangerous content, validates user input at system boundaries. | None (pure functions) |
| `pathValidator.js` | **Path safety.** Validates file paths for tool operations. Prevents path traversal attacks. Ensures tools can only access files within allowed directories. | path (Node.js built-in) |
| `memoryStore.js` | **Memory storage.** In-memory key-value store for session data. Used by the agentic loop to persist state across iterations. | None (in-memory) |
| `longTermMemory.js` | **Persistent memory.** Long-term memory that persists across sessions. Stores user preferences, project facts, conversation summaries. Written to disk. | fs (file persistence) |
| `sessionStore.js` | **Session persistence.** Saves and restores conversation session state. Allows resuming conversations after app restart. | fs (file persistence) |

### Tools (`tools/`)

| File | Role | Key Dependencies |
|------|------|-----------------|
| `mcpBrowserTools.js` | **Browser tools.** Tool definitions for web browsing: navigate, screenshot, click, fill forms. These define the INTERFACE — the actual browser engine (Playwright or equivalent) must be provided separately. | Browser engine (not included) |
| `mcpGitTools.js` | **Git tools.** Tool definitions for git operations: status, diff, commit, push, log. Uses git CLI under the hood. | git CLI (system dependency) |
| `toolParser.js` | **Parsing utilities.** Shared utilities for parsing tool-related content. Used by responseParser and mcpToolServer. | None (pure parsing) |

---

## What's Missing (Must Be Rebuilt)

| Component | What It Does | Notes |
|-----------|-------------|-------|
| **Transport layer** | Delivers streaming events between pipeline and UI | Current implementation uses Electron IPC. Replace with WebSocket, HTTP SSE, or direct calls depending on platform. Touch points: `streamHandler.js` `_send()` method, `agenticChat.js` IPC handlers. |
| **UI / Frontend** | Renders chat, code blocks, file operations, tool calls | No frontend code included. The pipeline emits streaming events — the UI consumes them. |
| **Electron shell** | App lifecycle, window management, menus, dialogs | Not included. The pipeline is pure Node.js. Can run in any Node.js environment with node-llama-cpp. |
| **Settings UI** | User preferences, model selection, theme, keybindings | Not included. The pipeline has internal defaults in `constants.js` and `modelProfiles.js`. |
| **Terminal emulation** | In-app terminal for running commands | Not included. The `run_command` tool executes commands but there's no terminal UI. |
| **File explorer** | Project file tree, file open/close, tabs | Not included. The pipeline reads/writes files via tools but doesn't manage a file tree UI. |
| **Code editor** | Text editing, syntax highlighting, intellisense | Not included. The pipeline generates code but doesn't provide an editor. |
| **RAG engine** | Retrieval-augmented generation from project files | Not included. Supplementary feature for injecting relevant project context into prompts. |
| **Image generation** | Local image generation via Stable Diffusion etc. | Not included. Separate feature from the text pipeline. |
| **Cloud services** | API key management, cloud LLM fallback | Not included. guIDE is local-first. |
| **Browser engine** | Playwright or equivalent for browser tool execution | Not included. `mcpBrowserTools.js` defines the tool interface; the engine must be provided. |
| **Context manager (OLD)** | Proactive rotation at fixed thresholds | **Intentionally excluded.** This was the old competing system that destroyed KV cache state. Replaced by Solution A (`nativeContextStrategy.js`). Do NOT rebuild it. |

---

## Dependency Map (External)

| Dependency | Why It's Needed | Critical? |
|-----------|----------------|-----------|
| `node-llama-cpp` | GGUF model loading, inference, KV cache, context shift hooks | **Yes — core** |
| `Node.js` (v18+) | Runtime for all pipeline code | **Yes — core** |
| `fs`, `path`, `os`, `child_process` | Node.js built-ins for file ops, process execution | **Yes — core** |
| `events` | Node.js EventEmitter for streaming | **Yes — core** |
| Git CLI | Used by `mcpGitTools.js` | Optional (git features only) |
| Playwright | Used by `mcpBrowserTools.js` | Optional (browser features only) |

---

## File Count Summary

| Category | Count |
|----------|-------|
| Documentation | 3 (RULES.md, ARCHITECTURE.md, MANIFEST.md) |
| Pipeline core | 8 |
| Engine & config | 14 |
| Tools | 3 |
| **Total pipeline files** | **25** |
| **Total with docs** | **28** |

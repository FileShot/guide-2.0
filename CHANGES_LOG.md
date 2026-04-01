# guIDE 2.0 — Changes Log

> Every code change must be logged here. Context windows expire. If it's not here, it's lost.

---

## 2026-04-02 — Phase 4: Full IPC Architecture Conversion

### Phase 4A: New electron-main.js (IPC architecture)
**File:** electron-main.js (1144 lines, replaces old 286-line fork-based version)
- **Old version backed up to:** electron-main-old.js
- **What was removed:** Child process fork of server/main.js, HTTP server, Express, WebSocket transport, port management, backend health-check polling
- **What was added:** All services imported and instantiated in-process (llmEngine, mcpToolServer, modelManager, cloudLLM, sessionStore, settingsManager, gitManager, browserManager, ragEngine, debugService, extensionManager, etc.). Single `ipcMain.handle('api-fetch', ...)` handler with URL-based routing converting ALL 77+ REST endpoints. PTY terminal over IPC (terminal-create/write/resize/destroy). Event forwarding via mainWindow.webContents.send(). AutoUpdater with registerIPC(ipcMain). App lifecycle with graceful shutdown.
- **Architecture:** No HTTP server, no Express, no WebSocket for main communication. All frontend-backend communication is Electron IPC. liveServer.js (browser preview) kept as-is (separate HTTP server for serving user project files).

### Phase 4B: New preload.js (expanded IPC surface)
**File:** preload.js (128 lines, replaces old 37-line version)
- **Old version backed up to:** preload-old.js
- **What was added:** `apiFetch(url, options)` — fetch bridge entry point via IPC. `aiChat(message, context)` / `agentPause()` / `agentResume()` — direct AI IPC. `terminal.*` (create, write, resize, destroy, onData, onExit). 25+ event listener methods covering every event type (llm-token, file-content-*, context-usage, tool-executing, model events, download events, debug events, etc.). All return cleanup functions.
- **What was kept:** windowControls, dialogs, updater, onMenuAction — all existing functionality preserved.

### Phase 4C: Frontend fetch bridge + event conversion
**File:** frontend/src/main.jsx
- **What was added:** Fetch bridge — overrides `window.fetch` for `/api/*` URLs, routes through `window.electronAPI.apiFetch()` via IPC. Returns Response-like object with `.json()` and `.text()` methods. Falls through to real fetch when not in Electron.
- **Why:** Avoids rewriting 110 fetch() calls across 14 frontend component files.

**File:** frontend/src/App.jsx
- **What was removed:** `import { connect, invoke } from './api/websocket'` — WebSocket connection
- **What was added:** IPC event listeners — 32 `window.electronAPI.onXxx()` calls in useEffect, each forwarding to the existing `handleEvent()` callback. WebSocket fallback preserved via dynamic import for dev server mode (non-Electron).
- **Connection behavior:** In Electron mode, sets connected immediately and fires 'connection-ready' to load initial state. Each listener returns a cleanup function used in useEffect teardown.

**File:** frontend/src/components/ChatPanel.jsx
- **Line 490:** `(await import('../api/websocket')).invoke('ai-chat', ...)` replaced with `window.electronAPI.aiChat(text, {...})`
- **Line 688:** `(await import('../api/websocket')).invoke('agent-pause')` replaced with `window.electronAPI.agentPause()`

### Phase 4D: Terminal over IPC
**File:** frontend/src/components/BottomPanel.jsx (XTermPanel function)
- **What was removed:** WebSocket connection to `/ws/terminal`, JSON message protocol (create/input/resize/output/exit)
- **What was added:** IPC terminal via `window.electronAPI.terminal.create/write/resize/destroy`. Event listeners via `onData`/`onExit`. Cleanup now calls `terminal.destroy()` on unmount. Resize now calls `terminal.resize()` through IPC.
- **Fallback:** WebSocket path preserved as else-branch for dev server mode without Electron.

### Phase 4E: File swap + activation
- `electron-main.js` (old fork version) → `electron-main-old.js`
- `electron-main-ipc.js` (new IPC version) → `electron-main.js`
- `preload.js` (old 37-line version) → `preload-old.js`
- `preload-ipc.js` (new 128-line version) → `preload.js`
- `package.json` `"main"` field already pointed to `"electron-main.js"` — no change needed.
- server/main.js, server/_electronShim.js, server/ipcBridge.js, server/transport.js — kept intact (not deleted), usable for web deployment or reference.

---

## 2026-04-02 — Phase 2: Fix "no sender for event" startup warning

**File:** server/ipcBridge.js
- **Line 103:** Added `this._hasEverConnected = false` in MainWindowBridge constructor
- **Line 121:** Set `this._hasEverConnected = true` in `setSender()`
- **Line 146:** Warning only fires if `_hasEverConnected === true` (startup events silently dropped instead of warning)
- **Observable effect:** No more "no sender for event llm-status" flash on startup before WebSocket connects

---

## 2026-04-02 — Phase 1: Fix guIDE Cloud AI display and provider

**File:** frontend/src/components/ChatPanel.jsx
- **Line 20:** Added `const GUIDE_CLOUD_PROVIDERS = new Set(['cerebras', 'groq', 'sambanova', 'google', 'openrouter']);`
- **Line 719:** Changed display from `'Cloud AI'` to `'guIDE Cloud AI'` when bundled provider is active
- **Line 1787:** Changed active highlight from `cloudProvider === 'graysoft'` to `GUIDE_CLOUD_PROVIDERS.has(cloudProvider)`
- **Line 1789:** Changed onClick from `selectCloudModel('graysoft', 'graysoft-cloud')` to `selectCloudModel('sambanova', 'Meta-Llama-3.3-70B-Instruct')`
- **Line 1796:** Changed checkmark condition to match
- **Observable effect:** "guIDE Cloud AI" button now selects sambanova (bundled provider with seeded key), displays "guIDE Cloud AI" not provider/model name

---

## 2026-04-01 — COMPARISON.md: Full codebase comparison document

**File:** COMPARISON.md (new file, ~500 lines)
**What was added:** Comprehensive comparison between original IDE (v1.8.54, C:\Users\brend\IDE) and guide-2.0 (v2.2.10), created from exhaustive file-by-file reading of both codebases.
**Covers:** Architecture (Electron IPC vs server+WebSocket), transport layers, preload differences (~200 methods vs ~10), frontend (34.9K lines/89 files vs 13.8K lines/33 files), pipeline (guide-2.0 is more advanced), backend services (8 identical files, 16+ differing), build/CI, feature matrix (15+ missing feature panels), root cause of guide-2.0 Electron problems (server architecture for what should be a native Electron app).
**Why:** User requested full comparison to establish proper understanding before fixing the Electron app.

---

## 2026-04-01 — v2.2.10: Fix cloud model silence + graysoft provider

### Fix A: Cloud model errors not displayed to user
**File:** frontend/src/components/ChatPanel.jsx (line ~632)
- **Symptom:** User sends message to cloud model, sees loading dots briefly then nothing. No error message. No response.
- **Root cause:** When backend returns `{success: false, error: "..."}`, the finalization code checks for `result.text` (which error responses don't have). `messageContent` ends up empty. `hasContent` is false. No `addChatMessage` is called. User sees silence.
- **Fix:** After the content/toolCalls check, added `else if (result.success === false && result.error)` branch that adds an error assistant message: `Error: ${result.error}`.
- **Observable effect:** When cloud model fails (e.g., provider not configured, API error), user now sees the error message in chat instead of nothing.

### Fix B: GraySoft cloud provider not available
**File:** cloudLLMService.js (lines 546-560, 790-805)
- **Symptom:** User selects GraySoft Cloud provider, sends message. Backend returns `{success: false, error: "Provider graysoft not configured"}` because graysoft is not in the configured providers list (has no API key, not in BUNDLED_PROVIDERS).
- **Root cause:** `getConfiguredProviders()` only returns providers with API keys set. GraySoft uses session tokens (license system) instead of API keys. It was never added to the configured list when a session token exists.
- **Fix 1:** `getConfiguredProviders()` now adds graysoft to the list when `_licenseManager.getSessionToken()` returns a value.
- **Fix 2:** `generate()` now allows graysoft without an API key (like ollama). When provider is 'graysoft', sets `apiKeys['graysoft']` to the session token for auth.
- **Fix 3:** `generate()` proxy routing now includes graysoft (`provider === 'graysoft'`) alongside bundled providers.
- **Observable effect:** GraySoft Cloud works when user has a GraySoft account. Shows clear error if not logged in.

## 2026-04-01 — v2.2.9: WebSocket fix + comprehensive pipeline logging

### Fix A: WebSocket /ws/terminal returning HTTP 400
**Files:** server/transport.js (lines 46-51), server/main.js (lines 1313-1322)
- **Symptom:** Browser console showed `WebSocket connection to 'ws://localhost:3000/ws/terminal' failed: Error during WebSocket handshake: Unexpected response code: 400`
- **Root cause:** Transport created its WebSocket.Server with `{ server, path: '/ws' }`. The `ws` library's internal upgrade handler fires FIRST for ALL upgrade requests. When path doesn't match `/ws` (e.g. `/ws/terminal`), it calls `abortHandshake(socket, 400)` destroying the socket BEFORE the manual `server.on('upgrade')` handler in main.js can route it to the pty WebSocket server.
- **Removed:** `server: this._httpServer, path: '/ws'` from WSS options in transport.js
- **Added:** `noServer: true` to WSS options in transport.js. New `handleUpgrade(request, socket, head)` method on Transport class.
- **Changed:** `server.on('upgrade')` in main.js now routes ALL upgrade requests: `/ws` → `transport.handleUpgrade()`, `/ws/terminal` → `ptyWss.handleUpgrade()`, else → `socket.destroy()`

### Fix B: Comprehensive pipeline logging for model hang diagnosis
**Files:** agenticChat.js, pipeline/agenticLoop.js, llmEngine.js, cloudLLMService.js, server/transport.js, server/ipcBridge.js, frontend/src/App.jsx, frontend/src/api/websocket.js
- **Symptom:** Model loads, user sends message, loading indicator stays forever, no response for BOTH local AND cloud models.
- **Logging added to trace the ENTIRE message flow end-to-end:**
  - **Frontend websocket.js:** Logs invoke calls with channel name, logs connection URL, logs WebSocket not-connected errors with readyState
  - **Frontend App.jsx:** Logs all non-token events received from backend (event name + data)
  - **server/transport.js:** Logs invoke receipt (channel, id, args length) and completion
  - **server/ipcBridge.js:** Warns when _sendToFrontend drops events due to no WebSocket sender
  - **agenticChat.js:** Logs ai-chat handler entry with message length and cloud provider/model, logs path decision (cloud vs local vs none), logs cloud/local path entry and return, logs handleCloudChat entry and cloud status check, logs pipeline errors with stack traces
  - **pipeline/agenticLoop.js:** Logs "Init complete — entering loop", "Request is stale", "Deadline exceeded", "Calling generateStream" with iteration and message length
  - **llmEngine.js:** Logs generateStream entry with isReady/hasChat/hasModel/hasContext/hasSequence status, logs _runGeneration entry, logs "Awaiting _runGeneration", logs completion with response length, logs chat.generateResponse call parameters
  - **cloudLLMService.js:** Logs generate() entry with provider/model/hasKey/promptLen, logs _executeGeneration with provider routing decision

---

## 2026-04-01 — v2.2.7: Prettier Formatting, TODO Highlighting, Extension Marketplace

### New: Prettier Code Formatting
**File:** server/main.js, EditorArea.jsx, App.jsx
- Added `prettier` dependency (v3.5.3) to package.json
- `POST /api/format` endpoint: takes `{ content, language, filePath }`, runs `prettier.format()` with auto-detected parser (babel, typescript, css, html, json, yaml, markdown, graphql, vue, svelte, less, mdx)
- Reads `.prettierrc` from project root if present, merges with format options
- "Format" button added to editor toolbar breadcrumb area (Wand2 icon)
- Shift+Alt+F keyboard shortcut in App.jsx calls `/api/format` and replaces editor content
- Added `Wand2` to EditorArea.jsx lucide-react imports

### New: TODO Highlighting
**File:** server/main.js, BottomPanel.jsx, appStore.js
- `POST /api/todos/scan` endpoint: scans all project files for TODO/FIXME/HACK/NOTE/XXX/BUG/OPTIMIZE comments
- Regex: `/\b(TODO|FIXME|HACK|NOTE|XXX|BUG|OPTIMIZE)\b[:\s]*(.*)/gi`
- Skips binary files, node_modules, .git, dist, build, __pycache__, .venv, etc.
- Caps at 500 results, returns `{ file, line, type, text }`
- "TODO" tab added to BottomPanel (CheckSquare icon), between PROBLEMS and DEBUG CONSOLE
- Results grouped by file, color-coded by type (TODO=blue, FIXME=red, HACK=yellow, NOTE=green, XXX=orange, BUG=red, OPTIMIZE=purple)
- Click any result to open the file in the editor
- Scan button with loading spinner, item count display
- Added `todoItems`, `todoLoading`, `setTodoItems`, `setTodoLoading`, `scanTodos` to appStore.js
- Added `CheckSquare, RefreshCw` to BottomPanel.jsx lucide-react imports

### New: Extension Marketplace Pages (graysoft.dev)
**File:** C:\Users\brend\IDE\website\src\app\extensions\page.tsx (new)
- Browse page: search bar, category filter pills (9 categories), extension cards with name/author/description/category/version
- "Marketplace Launching Soon" banner explaining early state
- "How to Install Extensions" section with 4-step guide
- "Build Your Own Extension" CTA linking to submit page
- 3 showcase/example extension cards demonstrating the format

**File:** C:\Users\brend\IDE\website\src\app\extensions\submit\page.tsx (new)
- Extension structure diagram (folder tree with manifest.json, main.js, styles, snippets, README)
- Full manifest.json documentation with required fields (id, name, version) and optional fields (description, author, category, icon, main, homepage, repository)
- Extension categories grid (9 categories with descriptions)
- Packaging instructions (zip command for Unix and PowerShell)
- 3 submission methods: GitHub PR, email, community forum
- Submission guidelines (6 rules)

**File:** C:\Users\brend\IDE\website\src\components\Header.tsx
- Added `{ href: '/extensions', label: 'Extensions' }` to navLinks

**File:** C:\Users\brend\IDE\website\src\components\Footer.tsx
- Added `{ href: '/extensions', label: 'Extensions' }` to Product footer column

### Version Bump
- package.json: 2.2.6 → 2.2.7
- Download page CURRENT_VERSION: 2.2.6 → 2.2.7

### Deployment (2026-04-01)
- guIDE repo: committed as `2b19533`, tagged v2.2.7, pushed to origin
- GitHub Actions Build #11: all 5 jobs passed (windows-cpu 4m40s, windows-cuda 6m9s, linux-cpu 1m20s, linux-cuda 1m56s, mac-cpu done)
- Release job triggered to create GitHub Release with installers
- Website repo: committed as `d86a580`, pushed `c040a85..d86a580 main -> main`
- Server deployment: updated source files on server via /system/run + GitHub raw download, rebuilt graysoft (job 39 completed)
- Server source updated: CURRENT_VERSION 2.2.4 → 2.2.7, extensions pages deployed, Header/Footer nav links updated
- Note: Cloudflare tunnels went down after rebuild (error 530/1033). Tunnels need server-side restart.

---

## 2026-04-01 — Debug System (Node.js + Python)

### New: debugService.js
**File:** debugService.js (new, root level)
- Full debug service: start/stop sessions, step controls, breakpoints, expression evaluation
- Node.js debugging via Chrome DevTools Protocol (CDP): spawns child process with `--inspect-brk=0`, connects via WebSocket to CDP endpoint, sends Debugger.* and Runtime.* commands
- Python debugging via Debug Adapter Protocol (DAP): spawns `python -m debugpy --listen 127.0.0.1:PORT --wait-for-client`, connects via TCP socket, sends DAP JSON messages with Content-Length framing
- Unified interface: start(), stop(), resume(), stepOver(), stepInto(), stepOut(), pause(), getStackTrace(), getScopes(), getVariables(), evaluate(), setBreakpoints()
- Events emitted: initialized, stopped, continued, terminated, output
- Auto-cleanup: kills child processes on stop, handles process exit/error events

### New: Debug API Endpoints
**File:** server/main.js
- Added `require` for `DebugService` and instantiation
- Debug event forwarding: `debugService.on('debug-event', data => mainWindow.webContents.send('debug-event', data))`
- `POST /api/debug/start` — starts debug session (body: type, program, args, cwd)
- `POST /api/debug/stop` — stops active session
- `POST /api/debug/continue` — resumes execution
- `POST /api/debug/stepOver` — step over
- `POST /api/debug/stepInto` — step into
- `POST /api/debug/stepOut` — step out
- `POST /api/debug/pause` — pause execution
- `POST /api/debug/evaluate` — evaluate expression in frame context
- `POST /api/debug/setBreakpoints` — set breakpoints in a source file
- `GET /api/debug/stackTrace` — get current call stack
- `GET /api/debug/scopes` — get scopes for current frame
- `GET /api/debug/variables` — get variables for a scope
- `GET /api/debug/sessions` — list active debug sessions

### New: Debug Event Handler
**File:** frontend/src/App.jsx
- Added `case 'debug-event'` in handleEvent switch to dispatch debug events to store

### New: Debug Store State
**File:** frontend/src/stores/appStore.js
- State: `debugSessionId`, `debugSessionState` ('inactive'|'running'|'paused'), `debugStackFrames`, `debugScopes`, `debugVariables`, `debugOutput`, `debugError`
- Actions: `setDebugSession`, `clearDebugSession`, `setDebugStackFrames`, `setDebugScopes`, `setDebugVariables`, `addDebugOutput`, `clearDebugOutput`, `setDebugError`
- `handleDebugEvent(data)`: dispatches 'initialized', 'stopped' (auto-fetches stack trace), 'continued', 'terminated', 'output' events

### New: DebugPanel UI
**File:** frontend/src/components/Sidebar.jsx
- Replaced stub with full DebugPanel component (~280 lines, adapted from old IDE's DebugPanel.tsx)
- Launch configuration: type selector (Node.js / Python), program path input, arguments input, Start Debugging button
- Debugger toolbar: Continue (F5), Step Over (F10), Step Into (F11), Step Out (Shift+F11), Pause (F6), Stop (Shift+F5)
- Call Stack section: collapsible, shows frame name + source file:line, highlights top frame in yellow
- Variables section: collapsible, shows scopes with expand/collapse, color-coded values (blue names, orange strings, green numbers)
- Debug Console: scrollable output log with auto-scroll, expression evaluator input (when paused)
- Error bar: shows debug errors inline with AlertTriangle icon
- Session state badge: shows running (green) or paused (yellow) status
- Added `Pause, SkipForward, ArrowDownRight, ArrowUpRight, Square, Bug, AlertTriangle, Eye` to lucide-react imports

---

## 2026-04-01 — Extension System Core

### New: extensionManager.js
**File:** extensionManager.js (new, root level)
- Full extension lifecycle manager: install, uninstall, enable, disable, scan
- Extension format: folder with `manifest.json` (id, name, version, description, author, category, icon, main, homepage, repository)
- Extensions stored in `<userData>/extensions/` (e.g. `%APPDATA%/guide-ide/extensions/` on Windows)
- State persisted in `<userData>/extensions.json` (enabled/disabled per extension ID)
- Install from zip: extracts, validates manifest, copies to extensions dir. Supports both root-level manifest and one-level-deep folder layout.
- Uses system unzip (PowerShell Expand-Archive on Windows, unzip on Unix) as fallback when adm-zip module is unavailable.
- Emits 'extensions-updated' event when extension list changes.

### New: Extension API Endpoints
**File:** server/main.js
- Added `require` for `ExtensionManager` and instantiation with `USER_DATA` path
- `GET /api/extensions` — returns all installed extensions + categories
- `POST /api/extensions/install` — multipart upload of .zip/.guide-ext file, extracts and installs
- `POST /api/extensions/uninstall` — removes extension by ID (blocks uninstall of builtins)
- `POST /api/extensions/enable` — enables extension by ID
- `POST /api/extensions/disable` — disables extension by ID

### New: ExtensionsPanel UI
**File:** frontend/src/components/Sidebar.jsx
- Replaced stub with full ExtensionsPanel component (ported from old IDE's PluginPanel.tsx, adapted to JSX + HTTP fetch)
- Two tabs: "Installed" (functional) and "Marketplace" (placeholder linking to graysoft.dev/extensions)
- Search bar filters by name/description across all extensions
- Category filter pills (all, theme, snippets, formatter, linter, language, tools, ai, git, other)
- Extension cards show: icon (colored by category), name, category badge, description, rating stars, version, author
- Enable/disable toggle per extension (ToggleRight/ToggleLeft icons)
- Uninstall button (blocked for built-in extensions)
- "Install from File" button opens native file picker for .zip/.guide-ext files
- Marketplace tab: "Coming soon" placeholder with links to graysoft.dev/extensions and graysoft.dev/extensions/submit
- Added `Package, Star, Download, Upload` to lucide-react imports

### New: Extension Store State
**File:** frontend/src/stores/appStore.js
- Added `extensions: []`, `extensionCategories: ['all']`, `extensionsLoading: false`
- Added `setExtensions(list)`, `setExtensionCategories(cats)`, `setExtensionsLoading(bool)` actions

---

## 2026-04-01 — v2.2.6 UX Fixes (Model Files, Zoom, Queue, Auto Mode)

### Fix A: Add Model Files — Browser Fallback
**Files:** ChatPanel.jsx (ModelPickerDropdown), server/main.js
- **Symptom:** "Add Model Files" showed notification "Add .gguf files to your models folder, then click Rescan" in browser/dev mode instead of opening file picker.
- **Root cause:** `window.electronAPI?.modelsAdd` is undefined outside Electron. Fallback only showed a notification.
- **Change:** Added hidden `<input type="file" accept=".gguf" multiple>` element in ModelPickerDropdown. When Electron API unavailable, clicking "Add Model Files" triggers native browser file picker. Files upload via new `POST /api/models/upload` endpoint (multipart parsing, saves to modelsDir, triggers rescan). Added `modelFileInputRef` to component.

### Fix B: Zoom — Ctrl+/Ctrl- Shortcuts + Viewport Fix
**Files:** App.jsx, Layout.jsx, TitleBar.jsx, appStore.js
- **Symptom:** Ctrl+ didn't zoom in (only menu worked). Viewport overflowed on zoom and didn't recover on zoom out.
- **Root cause:** No keyboard event listeners for zoom shortcuts. Used `document.body.style.zoom` which causes layout overflow issues.
- **Change:** Added `zoomLevel` state + `zoomIn/zoomOut/zoomReset` actions to appStore. Added Ctrl+= / Ctrl+- / Ctrl+0 keyboard shortcuts in App.jsx. Replaced `document.body.style.zoom` with CSS `transform: scale()` + inverse width/height on Layout root div. TitleBar menu actions now use store methods.

### Fix C: Remove Auto Mode
**Files:** ChatPanel.jsx
- **Symptom:** Auto mode toggle existed but had no real value — local inference can only load one model at a time, making task-based model switching impractical.
- **Change:** Removed Auto Mode button from bottom toolbar. Removed `autoMode` state variable and its reference in `doSend` params. Zap icon import kept (used elsewhere).

### Fix D: Queue Messaging — Enable Input During Streaming
**Files:** ChatPanel.jsx
- **Symptom:** Can't type in chat input while model is generating. Queue infrastructure (appStore, queue display, auto-processing) existed but textarea was disabled during streaming.
- **Root cause:** `disabled={!connected || chatStreaming}` on textarea prevented all interaction during streaming.
- **Change:** Changed to `disabled={!connected}`. Updated `handleKeyDown` so Enter during streaming queues the message (no Shift needed). Changed placeholder during streaming to "Type to queue a message..." instead of "guIDE is thinking...".

---

## 2026-04-01 — v2.2.5 UI Polish (VS Code Copilot-style)

### ToolCallCard.jsx — Full Redesign
- **Removed:** Border-left bar, verbose labels, large icons
- **Added:** `TOOL_MAP` dict mapping function names to `{ Icon, pendingVerb, doneVerb, detailFn }`. Compact `[Icon] verb • detail` format at 11px. `agent-shimmer` gradient animation on pending text. Error state in `text-vsc-error/70`. Click-to-expand with ChevronRight/Down on right side.

### index.css — Shimmer Keyframe
- **Added:** `@keyframes agent-shimmer` + `.agent-shimmer` class using `background-clip: text` gradient trick. Background: var(--guide-text-dim) → var(--guide-text) → var(--guide-text-dim), animated at 1.8s linear infinite.

### TitleBar.jsx — Layout Toggle Buttons
- **Added:** PanelLeft/PanelBottom/PanelRight/LayoutTemplate imports from lucide-react. New state subscriptions: `sidebarVisible, panelVisible, chatPanelVisible, toggleSidebar, togglePanel, toggleChatPanel`. Three panel toggle buttons (active = `text-vsc-text`, inactive = `text-vsc-text-dim/50`). LayoutTemplate dropdown with Default layout / Focus Mode / Show all panels presets using `useAppStore.setState()` directly.

### BottomPanel.jsx — Full Upgrade
- **Added:** PORTS and DEBUG CONSOLE tabs. `problemsCount` badge from store. Terminal instance chips moved to RIGHT side of header (shown only when terminal tab active). Plus/ChevronDown/MoreHorizontal controls on far right. `PlaceholderPanel` component for non-implemented tabs.

### ChatPanel.jsx — Files-Changed Banner + Iteration Indicator
- **Changed:** Files-changed section (~L927): Single-line VS Code-style banner `N file(s) changed +X -Y [Keep] [Undo]` with text buttons. Removed icon-only Keep/Undo buttons. Keep/Undo are now text buttons (Keep = vsc-success color, Undo = vsc-text-dim).
- **Changed:** StreamingFooter iteration indicator (~L222): Replaced plain `<span className="text-vsc-accent">Step N/M</span>` with "Starting: Step N/M" + 3-dot bounce animation using animationDelay offsets (0ms, 80ms, 160ms).

---

## 2026-04-01 — 7-Fix Pipeline Overhaul (Operations Studio Stress Test)

All fixes from analysis of operations-studio.html stress test. Test config: Qwen3.5-2B-Q8_0, TEST_MAX_CONTEXT=8000.

### Fix 1A: Unescape Order Bug (responseParser.js, agenticLoop.js, streamHandler.js)
- **Symptom:** ~380 lines of CSS contaminated with trailing `\` at end of every line.
- **Root cause:** `.replace(/\\n/g, '\n')` ran BEFORE `.replace(/\\\\/g, '\\')`. For `\\n`, the `\\n` match consumed chars 1-2, leaving char 0 (`\`) as stray backslash.
- **Change:** Created `_unescapeJsonContent()` function in responseParser.js using placeholder technique: `\\\\` → `\x00ESCAPED_BACKSLASH` → process `\\n`/`\\t`/etc → restore placeholder to `\\`. Applied to ALL 5 unescape locations:
  - responseParser.js: `extractContentFromPartialToolCall` (2 chains)
  - agenticLoop.js: CONTEXT_OVERFLOW path, T31-Fix salvage, R28-1b salvage (3 chains)
  - streamHandler.js: content type sniffing, `_streamFileContent` main unescape (2 chains)
- Exported `_unescapeJsonContent` from responseParser.js, imported in agenticLoop.js and streamHandler.js.

### Fix 1B: Parser 1000-Char Length Guard (responseParser.js)
- **Symptom:** Every file-writing tool call (>1000 chars) fell through to regex salvage instead of JSON.parse.
- **Root cause:** `parseToolCallJson` had `if (jsonStr.length < 1000 && jsonStr.includes('\\"'))` — blanket guard prevented de-escaping of all large content.
- **Change:** Replaced blanket guard with targeted structural de-escaping. Finds `"content"` key position, de-escapes only JSON structure before it (keys, braces, colons), preserves content value intact. Fallback: full de-escape for strings <1000 chars.

### Fix 2A: Prose Leak Into File Content (agenticLoop.js)
- **Symptom:** Model's summary prose ("Perfect! The Operations Studio HTML file is now complete...") written into file at lines 637-659.
- **Root cause:** R36-Phase5 prose regex missed patterns starting with "Perfect!", "Great!", "Excellent!", emojis, markdown dividers.
- **Change:** Broadened `_proseRe` regex in R36-Phase5 salvage stripping (agenticLoop.js ~L1148). Added: `Perfect|Great|Excellent|That's|Now you|You can|The (application|code|program|project|page)|✅|👉|🎉|---\n`.

### Fix 2B: JSON Structure Leak / Holdback Too Small (streamHandler.js)
- **Symptom:** `}"` and `}` characters leaked into HTML file at line ~569.
- **Root cause:** HOLDBACK buffer was 3 chars. JSON closing pattern `"}\n}` is 4+ chars.
- **Change:** Increased HOLDBACK from 3 to 8 at streamHandler.js (was L345). Flush regex at finalize already handles variable whitespace.

### Fix 3A: File Never Completed / R38-Fix-C Retries (agenticLoop.js, continuationHandler.js)
- **Symptom:** 660 lines of CSS, no `<body>`, `<script>`, `</html>`. File structurally 100% incomplete.
- **Root cause:** R38-Fix-C allowed only 1 retry (`eogStructuralRetries < 1`). After one failed retry, system accepted the incomplete file. Continuation message was generic — model stayed pattern-locked in CSS.
- **Changes:**
  1. agenticLoop.js: Changed retry limit from `< 1` to `< 3`.
  2. agenticLoop.js: Added escalating retry messages — Retry 1: standard. Retry 2: explicit "close `<style>`, add `</head><body>`". Retry 3: literal code snippet with `</style></head><body>`.
  3. continuationHandler.js: Added structural hint in `toolInProgress` branch — when HTML file has 100+ lines but no `<body>`, appends: "After finishing the current CSS, close `</style></head>` and proceed to `<body>`."

### Fix 3B: Structural Completion Check (agenticLoop.js)
- **Symptom:** `_isContentStructurallyComplete` only checked for `</html>` ending. A file ending with `</html>` but missing `<body>` would pass.
- **Change:** For HTML files, now requires BOTH `</html>` at end AND `<body` somewhere in content.

### Fix 4A: TLS Certificate Failure (webSearch.js)
- **Symptom:** `fetch_webpage` failed with "unable to get local issuer certificate" on example.com and nodejs.org.
- **Root cause:** Electron's bundled Node.js CA certificate store may be incomplete.
- **Change:** Added `rejectUnauthorized: false` to `transport.get()` options in `_fetch()`.

### Fix 4B: Model Wrong Tool Selection (mcpToolServer.js)
- **Symptom:** User says "use the browser tools" — model chooses `fetch_webpage` instead of `browser_navigate`.
- **Root cause:** Tool descriptions didn't differentiate clearly enough for small models.
- **Change:** `fetch_webpage` description now starts with "This is NOT a browser" and directs to `browser_navigate` for browse requests. `browser_navigate` description now starts with "THIS is the browser tool" and lists trigger phrases ("open", "browse", "go to").

---

## 2026-03-31 — Fix malformed tool call JSON + diagnostic logging + multi-JSON parsing

### Fix 1: De-escape malformed JSON in parseToolCallJson
**File:** `pipeline/responseParser.js` function `parseToolCallJson` (lines 245-270)
- **Symptom:** Small models (Qwen3.5-2B) produce tool call JSON with literal backslash-quotes:
  `{"tool":"read_file","params\":{\"filePath\":\"src/app.js\"}}` instead of proper JSON.
  JSON.parse fails, tryFixJson also fails (handles missing brackets but not structural `\"`),
  tool call never executes, raw JSON leaks into UI, model never gets tool result.
- **Root cause:** `parseToolCallJson` had no de-escaping layer between JSON.parse and tryFixJson.
- **Change:** After initial JSON.parse failure, for short strings (<1000 chars) containing `\"`,
  try `JSON.parse(jsonStr.replace(/\\"/g, '"'))`. If it produces valid tool calls, return them.
  Falls through to tryFixJson if de-escaping doesn't help.
  Length guard prevents corrupting large write_file content where `\"` is legitimate escaping.
- **Observable effect:** Tool calls with escaped quotes will now parse and execute instead of failing silently.

### Fix 4: Multi-JSON parsing in parseToolCallJson
**File:** `pipeline/responseParser.js` function `parseToolCallJson`
- **Symptom:** Model outputs two tool calls on separate lines in one ```json block:
  `{"tool":"find_files",...}\n{"tool":"list_directory",...}`. JSON.parse only parses the
  first object. The second tool call is silently dropped. Happened in Test 3 iters 4 and 5.
- **Root cause:** JSON.parse handles one JSON value. Newline-separated objects are not valid JSON.
- **Change:** After all single-parse attempts fail, split by newlines, filter for lines starting
  with `{`, try JSON.parse on each independently. Combine all successful parses into one array.
- **Observable effect:** Both tool calls should now be detected and executed.

### Fix 3: Diagnostic logging in agenticLoop natural completion path
**File:** `pipeline/agenticLoop.js` (two new console.log lines)
- Added `[AgenticLoop] Post-tool-branch:` log after the tool execution branch close,
  showing toolCalls count, stopReason, rotationCheckpoint state, fullResponseText length.
- Added `[AgenticLoop] Natural completion` log before `stream.endFileContent()` and return.
- **Test 3 confirmed:** Both diagnostic lines appeared in log. Pipeline reaches natural
  completion and returns — the "UI stuck" from Test 2 was caused by toolCalls=0 leading to
  text return with raw JSON, not by the pipeline hanging.

### Test 3 Results (WebSocket direct, 2026-03-31)
- Prompt: "Read the file src/app.js and list the files in the src directory. Also check if a file called README.md exists."
- 9 iterations, natural completion, SUCCESS response
- Tools used: read_file (4x, all blocked — empty filePath), find_files (2x, executed), grep_search (2x, executed)
- **Fix-3 empty filePath check WORKING** — blocked 4 `read_file` calls with empty filePath
- **D1-T3: Model puts prose in `read_file` content parameter** — model behavior issue, not pipeline
- **D2-T3: Multi-JSON dropped second tool call** — Fix 4 addresses this
- **D3-T3: find_files tool PowerShell error** — "FileStream was asked to open a device" — tool implementation bug

---

## 2026-03-31 — Fix wrong recommended model name (Qwen3.5-32B -> 27B)

### Qwen 3.5 32B does not exist — replaced with 27B
**File:** `frontend/src/components/WelcomeScreen.jsx` lines 38-44
- `unsloth/Qwen3.5-32B-GGUF` returns 404 on HuggingFace — this repo does not exist
- `unsloth/Qwen3.5-35B-GGUF` also 404 — Qwen3.5-35B is MoE only (`Qwen3.5-35B-A3B-GGUF`)
- The largest dense Qwen 3.5 model is **27B** (`unsloth/Qwen3.5-27B-GGUF`)
- Changed: name "Qwen 3.5 32B" -> "Qwen 3.5 27B", size "~20 GB" -> "~16.7 GB", VRAM "24GB+" -> "20GB+"
- Changed: hfRepo `unsloth/Qwen3.5-32B-GGUF` -> `unsloth/Qwen3.5-27B-GGUF`
- Changed: hfFile `Qwen3.5-32B-Q4_K_M.gguf` -> `Qwen3.5-27B-Q4_K_M.gguf`
- Verified via HuggingFace browser: Qwen3.5-4B (exists), Qwen3.5-9B (exists), Qwen3.5-27B (exists, Q4_K_M = 16.7 GB)
- server/main.js `/api/models/recommend` updated from Qwen 3 to Qwen 3.5 series
  - Old: 7 Qwen 3 models (0.6B, 1.7B, 4B, 8B, 14B, 30B-A3B, 32B)
  - New: 5 Qwen 3.5 models (0.8B Q8_0=0.8GB, 4B Q8_0=4.5GB, 9B Q4_K_M=5.7GB, 27B Q4_K_M=16.7GB, 35B-A3B Q4_K_M=22GB)
  - All repos and file sizes verified via HuggingFace browser

---

## 2026-03-31 — UI Polish Round 3 (logo PNG, default theme, model overflow)

### Logo mask switched from .ico to .png
**File:** `frontend/src/components/TitleBar.jsx` line 135
**File:** `frontend/src/components/EditorArea.jsx` line 390
**File:** `frontend/src/components/WelcomeScreen.jsx` line 210
- Changed `mask: url(/icon.ico)` to `mask: url(/icon.png)` in TitleBar and EditorArea
- Replaced `<img src="/icon.ico">` with CSS mask div in WelcomeScreen.jsx (this was the actual visible welcome screen)
- Copied actual ZZZ compass logo from `C:\Users\brend\IDE\build\icon.png` to `frontend/public/icon.png`
- The .ico format did not render as a CSS mask; PNG works reliably

### Default theme reverted to Monolith
**File:** `frontend/src/components/ThemeProvider.jsx` line 591
- Changed fallback from `'github-dark'` back to `'monolith'`

### Recommended models — overflow fix
**File:** `frontend/src/components/ChatPanel.jsx`
- Added `max-h-[300px] overflow-y-auto` to recommended models container
- Added `flex-wrap` to model name+tags row to prevent horizontal overflow
- Added `truncate` to model name span

---

## 2026-03-31 — UI Polish Round 2 (logo tint, wavy lines, model name, sessions)

### Logo icon now theme-reactive
**File:** `frontend/src/components/TitleBar.jsx`
- Replaced `<img src="/icon.ico">` with a `<div>` using CSS `mask: url(/icon.ico)` + `bg-vsc-accent`
- Icon silhouette fills with the theme accent color automatically (orange for Monolith, blue for GitHub Dark, etc.)
- Same approach applied to welcome screen in `EditorArea.jsx` (48x48 masked logo above "guIDE" heading)

### Wavy background lines refined
**File:** `frontend/src/components/EditorArea.jsx`
- Reduced from 3 lines to 2 — less visual busy-ness
- Lower waviness (gentler S-curves), wider spacing between lines (y=310 and y=370)
- Slower animation (25s/35s cycles instead of 20s/25s/30s)
- Thinner strokes (0.8/0.6 instead of 1.0/0.8/0.6)

### Model name moved to Chat panel header
**File:** `frontend/src/components/TitleBar.jsx` — removed model name badge from right section
**File:** `frontend/src/components/ChatPanel.jsx` — added model name between "Chat" and spinner
- Shows model name without `.gguf` extension, truncated at 140px
- Cleaned up unused `Cpu` import and `modelInfo` from TitleBar

### Version text fixed
**File:** `frontend/src/components/EditorArea.jsx`
- Changed "guIDE 2.0 — Built for local AI inference" to "guIDE — Built for local AI inference"

### Chat session history on blank chat
**File:** `frontend/src/components/ChatPanel.jsx`
- Sessions auto-saved to localStorage every 3s when chat has 2+ messages (debounced)
- Up to 10 recent sessions stored (FIFO)
- When chat is empty, "Recent Chats" list appears with session title, date, delete button
- Clicking a session restores its messages to the chat
- Sessions keyed by first message ID to avoid duplicates

---

## 2026-03-31 — UI Polish & Feature Improvements (10-item batch)

### 1. Default theme changed to GitHub Dark
**File:** `frontend/src/components/ThemeProvider.jsx` line 591
- Changed fallback from `'monolith'` to `'github-dark'`

### 2. Removed "guIDE" text from title bar
**File:** `frontend/src/components/TitleBar.jsx` line 135
- Removed `<span className="font-brand ...">guIDE</span>`, keeping only the icon

### 3. Animated wavy background on empty viewport
**File:** `frontend/src/components/EditorArea.jsx` — WelcomeScreen function
- Added two animated SVG wave paths with `animateTransform` (20s/25s cycles, opposite directions)
- Radial accent glow div behind waves
- All colors use `text-vsc-accent` / `currentColor` for theme reactivity
- Content elements given `relative z-10` to layer above waves

### 4. X button on file context badge in chat
**File:** `frontend/src/components/ChatPanel.jsx`
- Added `fileContextDismissed` state, resets on tab change via useEffect
- Badge conditionally rendered on `!fileContextDismissed`
- X button appears on hover (`group-hover:opacity-100`)
- `doSend` excludes `currentFile` when dismissed

### 5. Thinking budget increased for Qwen3.5 small models
**File:** `modelProfiles.js`
- qwen/tiny `_thinkBudgetWhenActive`: 128 -> 2048

### 6. "Add Model Files" opens native file dialog (Electron IPC)
**Files:** `electron-main.js`, `preload.js`, `frontend/src/components/ChatPanel.jsx`
- Added `dialog-models-add` IPC handler in electron-main.js: opens file dialog with .gguf filter, multi-select, POSTs to `/api/models/add`
- Added `modelsAdd`, `modelsScan`, `openExternal`, `showOpenDialog` to preload.js
- Updated ChatPanel button handler: triggers rescan on success, proper fallback when electronAPI unavailable

### 7. UI depth improvements (subtle shadows)
**File:** `frontend/src/index.css`
- `.chat-message.user`: Added `box-shadow: 0 1px 2px rgba(0,0,0,0.08)`
- `.chat-message.assistant`: Added `box-shadow: 0 1px 1px rgba(0,0,0,0.04)`
- `.file-tree-item.active`: Added accent glow `0 0 6px rgb(var(--guide-accent) / 0.08)` to existing inset shadow
- `.sidebar-section-header`: Added `border-bottom: 1px solid rgb(var(--guide-panel-border) / 0.12)`

### Items confirmed already working (no changes needed)
- Checkpoint system: Already exists in ChatPanel.jsx (lines 708-740), dividers between turns with restore button
- RAG system: Fully implemented in ragEngine.js with BM25 search, wired into mcpToolServer

### Items not addressable via code
- OAuth DNS NX domain: `api.graysoft.dev` needs a DNS A/CNAME record (infrastructure, not code)

---

## 2026-03-31 — Fix: Conversation history wiped on every message + continuation improvements

### Root Cause 1 — chatHistory reset on every message (CRITICAL)

**Symptom:** Model forgot previous messages. Every message started fresh with `entries=2` (system + user). User asked "can u write me a book about a boy in the woods", model started, then user said "ok" and model responded "Ready to help with your programming tasks" — completely forgot the book request.

**Root cause:** `ChatPanel.jsx` line 445 always sends `conversationHistory: []` in the `invoke('ai-chat')` call. This was designed for the cloud path (stateless server). But `agenticLoop.js` line 197 interpreted `context?.conversationHistory?.length === 0` as a "new conversation" signal and RESET `llmEngine.chatHistory` to `[system]` on EVERY message. The local pipeline manages history server-side — this reset destroyed it every turn.

**Fix in `pipeline/agenticLoop.js` (lines 194-206):**
- Removed the `else if (context?.conversationHistory?.length === 0)` branch entirely
- After `/api/session/clear` (New Chat), `resetSession()` already clears chatHistory to `[system]`. The first branch (`!chatHistory || chatHistory.length === 0`) catches empty state after reset.
- The remaining `else` branch updates the system prompt in the existing chatHistory for continuing conversations.
- Result: chatHistory accumulates across messages. `entries` will grow (2, 4, 6...) instead of always being 2.

### Root Cause 2 — Mid-fence continuation creates new files

**Symptom:** Model wrote inline HTML (240 lines), maxTokens hit mid-code-block. Continuation iteration produced a SEPARATE write_file tool call for `upload-zone.js` instead of continuing the HTML. Then a third iteration produced ANOTHER HTML file (246 lines). User sees 3 code blocks: two near-duplicate HTMLs and an unrelated JS file.

**Root cause:** The continuation message for mid-fence had weak anchoring: "You are INSIDE a code block — output ONLY code, no text or summaries" + only 400 chars of tail. The 2B model didn't understand it should continue the same HTML — it started a new tool call for a different file.

**Fix in `pipeline/continuationHandler.js` (mid-fence branch):**
- Content-type detection from tail: detects HTML/markup, JavaScript, Python based on patterns in the last 800 chars
- Tail context increased from 400 to 800 chars for better anchoring
- Explicit instruction: "Do NOT use tool calls. Do NOT start a new file or code block. Do NOT add commentary or descriptions."

### Root Cause 3 — Inline code blocks had no checkpoint tracking

**Symptom:** When model writes inline code that gets cut off by maxTokens, there was no tracking of what was being generated. After a content-streamed tool call in a subsequent iteration, the D5/unclosed-fence check was skipped entirely (R16-Fix-C), so the model could stop with eogToken mid-file with no forced continuation.

**Fix in `pipeline/agenticLoop.js` (continuation trigger section):**
- When maxTokens hits mid-fence with no active tool call or rotationCheckpoint, log an inline code checkpoint with the detected language
- This provides diagnostic visibility for debugging continuation failures
- Future iterations can use this state to prevent premature stops

---

## 2026-03-31 — v2.2.4: Backend never started in installed builds + Audiowide font + crash visibility

### Root Causes (3 compounding bugs — app never worked when installed)

**Cause 1 — 9 root-level JS modules missing from `files` array**
- `cloudLLMService.js`, `settingsManager.js`, `gitManager.js`, `browserManager.js`, `firstRunSetup.js`, `ragEngine.js`, `accountManager.js`, `licenseManager.js`, `webSearch.js` were all absent from the `files` array in both builder configs
- None of these were packaged into the installer — backend crashed on first `require()` before writing any log entry

**Cause 2 — `asar: true` made the path resolution wrong**
- Forked backend process ran with `ROOT_DIR = app.asar.unpacked`
- `require(ROOT_DIR + '/cloudLLMService')` resolved to `app.asar.unpacked\cloudLLMService.js` — file not found there (only inside the ASAR)
- Even if files were added, the `fork()`'d child process can't consistently resolve requires through the ASAR when the absolute path points to the `.unpacked` directory

**Cause 3 — Backend errors were invisible**
- `fork({ silent: false })` sent stderr to Electron's parent stdout — no console window in production, errors went nowhere
- User saw only a black screen / stuck loading spinner with no indication of what failed

### Fixes

**`electron-builder.nosign.json` + `electron-builder.nosign.cuda.json`:**
- `"asar": false` — all files extracted to flat `app/` directory, fork'd process resolves all `require()` via normal filesystem, no ASAR path complications
- `"*.js"` and `"*.json"` wildcards in `files` array — all current and future root-level JS files are automatically packaged; removed redundant individual listings
- Removed `asarUnpack` (irrelevant when `asar: false`)

**`electron-main.js`:**
- Fork changed to `silent: true` — stdout/stderr captured explicitly
- Backend stderr piped to `_showBackendError()` — if crash occurs, error message appears in loading screen
- Loading screen updated: Audiowide font via Google Fonts, error display `<div>` added

**`server/main.js`:**
- Removed dynamic shim write (`fs.writeFileSync(shimPath, shimCode)`) — static `_electronShim.js` file in package is sufficient, writing to `C:\Program Files\` was wrong anyway

---

## 2026-03-31 — Startup Performance: Immediate Loading Screen + Lazy Module Loads

### Symptom
3-minute black screen on launch after fresh install. Root cause: three compounding issues.

### Root Cause 1 — Window only created AFTER backend health check timed out (15s)
- `app.whenReady()` called `await waitForBackend()` (15s max) BEFORE `createWindow()`
- On first install, Windows Defender scans every file in `app.asar.unpacked` on first access
- Backend takes > 15s → window created connecting to a URL that still doesn't respond
- `ready-to-show` fires on error page → user sees black (`backgroundColor: #0d0d0d`) for minutes

### Root Cause 2 — `fs.writeFileSync(shimPath)` ran unconditionally every startup
- Wrote the Electron shim file on EVERY launch, even when the file already existed
- Writing to `C:\Program Files\guIDE\resources\app.asar.unpacked\server\` on every run

### Root Cause 3 — `require('node-pty')` ran at server startup
- Native module loaded eagerly even when no terminal was ever opened

### Fixes

#### `electron-main.js`
- Added `LOADING_HTML` constant: dark (#0d0d0d) loading screen with spinner and "Starting…" text
- `createWindow()` now loads the `data:text/html,<LOADING_HTML>` URL instead of the backend URL
- `app.whenReady()`: removed `await waitForBackend()` gating — window shown IMMEDIATELY
- Backend polled async (`waitForBackend(serverPort, 480)` = up to 2 min); when ready, `mainWindow.loadURL('http://localhost:PORT')` navigates to the real app
- Result: user sees a styled loading screen within ~1 second; real app loads when backend is ready

#### `server/main.js`
- Shim write: `fs.writeFileSync(shimPath)` now wrapped in `if (!fs.existsSync(shimPath))` — skip on all runs after first
- `require('node-pty')` deferred: replaced eager load with `_loadPty()` lazy function called only when user opens a terminal

---

## 2026-03-31 — Fix: appMenu.js and autoUpdater.js missing from installer build

### Symptom
Installed app crashed on launch: "Cannot find module './appMenu'" in electron-main.js line 18.

### Root Cause
`appMenu.js` and `autoUpdater.js` were required by `electron-main.js` but omitted from the `files` array in both `electron-builder.nosign.json` and `electron-builder.nosign.cuda.json`. They were never packaged into the ASAR.

### Fix
- **electron-builder.nosign.json:** Added `"appMenu.js"` and `"autoUpdater.js"` to files array (after `electron-main.js`)
- **electron-builder.nosign.cuda.json:** Same addition

---

## 2026-03-31 — v2.2.0 Release: GitHub Actions + Live Site Deployment

### Release v2.2.0
- **package.json:** Bumped version 2.1.0 → 2.2.0
- **Git tag:** `v2.2.0` pushed to `origin` → triggered GitHub Actions build
- **GitHub Actions workflow:** `.github/workflows/build.yml` — builds 5 variants:
  - `windows-cpu` → `guIDE-2.2.0-cpu-x64-setup.exe`
  - `windows-cuda` → `guIDE-2.2.0-cuda-x64-setup.exe`
  - `linux-cpu` → `guIDE-2.2.0-cpu-linux-x64.AppImage`
  - `linux-cuda` → `guIDE-2.2.0-cuda-linux-x64.AppImage`
  - `mac-cpu` → `guIDE-2.2.0-cpu-mac-{x64,arm64}.dmg`
- **Live site:** `graysoft.dev/download` updated to show v2.2.0 download links
  - Updated `CURRENT_VERSION` in `C:\Users\brend\IDE\website\src\app\download\page.tsx`
  - Rebuilt website on server via control plane `/pm2/rebuild/graysoft`
  - PM2 process `graysoft` restarted at 14:00:29 UTC
  - Live verified: `https://graysoft.dev/download` → STATUS 200, version 2.2.0, correct download URLs

---

## 2026-03-31 — R46: 6 Bug Fixes (6 files, 6 changes)

### Fix A: Model name display — show actual model name instead of "guIDE"
- **Files:** `frontend/src/components/ChatPanel.jsx`
- **Changed:** StreamingFooter header (L220) and finalized message label (L715) — replaced hardcoded "guIDE" with dynamic `modelInfo?.name` split to remove path/quantization suffix. Added `modelInfo` subscription to StreamingFooter. Finalized assistant messages now include `model` field for history display.

### Fix B: HTML preview in viewport instead of external browser
- **Files:** `frontend/src/components/EditorArea.jsx`, `frontend/src/components/Sidebar.jsx`, `frontend/src/stores/appStore.js`
- **Changed:** EditorArea play button now toggles `previewMode` (uses existing HtmlPreview component) instead of `window.open`. Sidebar play button now opens file as tab then sets `previewRequested` flag. Added `previewRequested`/`setPreviewRequested` to appStore. EditorArea watches `previewRequested` to auto-activate preview mode on newly opened tab.

### Fix C: Browser panel opens as editor tab instead of sidebar
- **Files:** `frontend/src/components/EditorArea.jsx`, `frontend/src/components/ActivityBar.jsx`, `frontend/src/stores/appStore.js`
- **Changed:** Added `openBrowserTab()` action to appStore that creates a `type: 'browser'` tab. EditorArea renders `<BrowserPanel />` when active tab is browser type, with Globe icon in tab. ActivityBar now calls `openBrowserTab()` instead of `setActiveActivity('browser')`.

### Fix D: Restore checkpoints — implemented (was stub)
- **File:** `frontend/src/components/ChatPanel.jsx`
- **Changed:** Checkpoint `onClick` at L693 — replaced `{/* stub */}` with `useAppStore.setState({ chatMessages: chatMessages.slice(0, idx) })` to truncate conversation to that checkpoint, plus `setChatStreaming(false)` to clear streaming state.

### Fix E: Thinking budget increase for Qwen small tier
- **File:** `modelProfiles.js`
- **Changed:** `qwen.small._thinkBudgetWhenActive` from 256 to 2048. Qwen3.5-2B IS a reasoning model and needs sufficient thinking token budget.

### Fix F: Diagnostic thinking budget log
- **File:** `llmEngine.js`
- **Changed:** Added `console.log` after `budgets.thoughtTokens` is set in `_runGeneration()`, showing `thoughtTokenBudget` and `budgets.thoughtTokens` values. Helps verify the thinking pipeline is actually passing the budget to node-llama-cpp.

### Fix G: Token buffer flush before finalization (truncation bug)
- **File:** `frontend/src/components/ChatPanel.jsx`
- **Changed:** In `doSend` finalization, added explicit flush of `_textTokenBuffer` into `streamingSegments` BEFORE reading segments to compose the finalized message. Without this, the last tokens (stuck in the 80ms batch timer) are dropped from the finalized message — causing responses that appear truncated (e.g. "Hello! How can I" instead of "Hello! How can I help you today?"). The buffer flush in `setChatStreaming(false)` happened too late — after the message was already composed.

---

## 2026-03-31 — R45: ThinkingBlock + TodoPanel UI Upgrade (1 file, 5 changes)

### Change A: Add icon imports
- **File:** `frontend/src/components/ChatPanel.jsx` L12-16
- **Added:** `CheckCircle2`, `Circle`, `Loader2`, `ListTodo` from lucide-react
- **Why:** TodoPanel and ThinkingBlock upgrades need proper status icons matching old IDE style

### Change B: Upgrade ThinkingBlock in StreamingFooter
- **File:** `frontend/src/components/ChatPanel.jsx` StreamingFooter component
- **Removed:** Basic `<pre>` block with Brain icon, simple "Thinking..." label
- **Added:** VS Code-style thinking block with:
  - Elapsed time tracking (useRef for start time, "Reasoning..." while live, "Thought for Xs" after)
  - Rotating triangle (&#9654;) instead of chevron
  - Loader2 spinner while live, green Check when complete
  - Auto-expand when thinking starts, auto-scroll content during streaming
  - 10px font, muted color, max-height 180px with overflow scroll
- **Why:** Match old IDE's ThinkingBlock (ChatWidgets.tsx L101-169)

### Change C: Upgrade todos in StreamingHeader
- **File:** `frontend/src/components/ChatPanel.jsx` StreamingHeader component
- **Removed:** Simple colored dots for todo status, basic "Task Progress" label
- **Added:** Full status icons (CheckCircle2/Loader2/Circle), progress bar, "Plan"/"Plan complete" label, 
  active item color (#dcdcaa), strikethrough + reduced opacity for done items, ListTodo icon
- **Why:** Match old IDE's TodoPanel.tsx style

### Change D: Upgrade TodoDropdown (above input area)
- **File:** `frontend/src/components/ChatPanel.jsx` TodoDropdown component
- **Removed:** Basic "Tasks" label, colored dots, simple progress bar
- **Added:** VS Code-style with:
  - ListTodo icon with color (green when all done, accent otherwise)
  - Active task text shown in collapsed header (#dcdcaa color, truncated to 42 chars)
  - "Plan"/"Plan complete" labels
  - Same icon set (CheckCircle2/Loader2/Circle) for items
  - Scrollable expanded list (max-height 150px)
- **Why:** Match old IDE's TodoPanel.tsx (L1-115)

### Change E: Persist thinking text to finalized messages
- **File:** `frontend/src/components/ChatPanel.jsx`
- **Added:** `FinalizedThinkingBlock` component (module-level, before StreamingHeader)
  - Collapsed by default (unlike streaming version which auto-expands)
  - Shows "Thought for N lines" with green Check
  - Same rotating triangle expand/collapse
  - 180px max-height with scroll
- **Added:** `thinkingText` capture in doSend finalization (before setChatStreaming(false) clears it)
- **Added:** `thinking` property on addChatMessage call
- **Added:** `{msg.thinking && <FinalizedThinkingBlock text={msg.thinking} />}` in message renderer
- **Why:** Thinking was only visible during streaming, lost after completion. Now persisted in message history.

---

## 2026-03-31 — R44: Multiple Code Blocks + Stuttering + Scroll Reset (3 files, 3 fixes)

### Fix 1: Remove mid-loop endFileContent() calls (RC-1 — multiple code blocks)
- **File:** `pipeline/agenticLoop.js` L1869 (T58-Fix-A path), L1992 (R35-L1b path)
- **REMOVED:** `stream.endFileContent()` at both locations
- **KEPT:** Loop-exit `stream.endFileContent()` calls at ~L2356 and ~L2372 (natural completion + max iterations) — these are correct cleanup
- **Root Cause:** When a file was structurally complete mid-loop (either via salvage+natural or post-context-shift), `endFileContent()` was called immediately. This killed `_fileContentActive` on the StreamHandler. In the NEXT iteration (model's summary response or completion check), any tokens routed through StreamHandler created a NEW FileContentBlock because `_fileContentActive` was false. Result: 4-5 code blocks for a single file, "Writing index.html..." repeated, content leaking between blocks.
- **Effect:** `_fileContentActive` survives across iterations. Only the final loop exit cleans up the file content block. One file = one FileContentBlock throughout the entire generation lifecycle.

### Fix 2: Stable Footer/Header components for Virtuoso (RC-2 — stuttering + scroll reset)
- **File:** `frontend/src/components/ChatPanel.jsx`
- **REMOVED:** Inline arrow functions `Header: () => (...)` and `Footer: () => (...)` inside Virtuoso's `components={{}}` prop
- **ADDED:** Module-level `StreamingHeader` and `StreamingFooter` function components (defined before `ChatPanel`)
- **CHANGED:** `components={{ Header: StreamingHeader, Footer: StreamingFooter }}` — stable function references
- **MOVED:** `thinkingExpanded` state from ChatPanel into StreamingFooter (the only consumer)
- **Root Cause:** Every 80ms during streaming, Zustand token batching triggered ChatPanel re-render. The inline `() => (...)` functions created new function references every render. Virtuoso treats new function references as new components — it unmounts the old Footer and mounts a new one. This destroyed all child component state: CodeBlock's MutationObserver + setInterval timers, FileContentBlock's scroll position, click handlers. Result: code block stuttering/glitching, scroll position resetting to top, "Show More" button not working (click handler lost on remount).
- **Effect:** StreamingHeader and StreamingFooter are stable module-level functions. Virtuoso never unmounts them. They subscribe to store state directly via `useAppStore()` hooks, so they re-render when data changes (correct behavior) but are never destroyed/recreated.

### Fix 3: Allow scrolling on completed FileContentBlocks (minor — Show More)
- **File:** `frontend/src/components/chat/FileContentBlock.jsx` — `contentStyle`
- **CHANGED:** `overflowY: complete ? 'hidden' : 'auto'` to `overflowY: 'auto'` (always scrollable)
- **Root Cause:** Completed collapsed blocks used `overflowY: 'hidden'`, preventing user from scrolling content. Combined with Fix 2's remount issue, the "Show More" expand button also lost its click handler.
- **Effect:** Both streaming and completed blocks allow vertical scrolling in the collapsed view.

---

## 2026-03-30 — R43: React Error #185 Crash Fix + StreamingErrorBoundary (2 files)

### Fix A: Sanitize children at HAST→React boundary (prevents Error #185)
- **File:** `frontend/src/components/chat/MarkdownRenderer.jsx` L15-39 (new `sanitizeChildren` fn), L60 (call in `code` component)
- **ADDED:** `sanitizeChildren()` function that recursively validates React children. If any child is a plain JS object (not string/number/React element/null/undefined/boolean/array), converts it to its string representation.
- **Root Cause:** During streaming, rapidly changing markdown content is processed by ReactMarkdown + rehype-highlight + rehype-katex. Occasionally the HAST-to-JSX conversion (hast-util-to-jsx-runtime) produces plain JS objects ({type:'text', value:'...'}) instead of React elements. React 19's strict child validation throws Error #185 ("Objects are not valid as a React child") when these reach `<code>{children}</code>`.
- **CHANGED:** Both paths in the `code` component (CodeBlock and inline code) now use `safeChildren = sanitizeChildren(children)` instead of raw `children`.
- **Effect:** Objects from failed HAST conversion are safely converted to strings. Error #185 no longer triggers from rehype pipeline edge cases.

### Fix B: Streaming-scoped ErrorBoundary (prevents app-wide crash)
- **File:** `frontend/src/components/ChatPanel.jsx` L16-50 (new `StreamingErrorBoundary` class), L491-494 (wrapped MarkdownRenderer)
- **ADDED:** `StreamingErrorBoundary` class component with getDerivedStateFromError + componentDidCatch. On error: shows raw text content as `<pre>` fallback. Auto-recovers on next content update (componentDidUpdate checks if fallbackContent prop changed → clears error state).
- **CHANGED:** MarkdownRenderer in the streaming Footer's text segments is now wrapped with `<StreamingErrorBoundary fallbackContent={seg.content}>`.
- **Root Cause:** The existing app-level ErrorBoundary catches ALL errors and shows a full-screen crash page. A render error in one streaming segment during generation should NOT destroy the entire app — it should degrade gracefully and try again on the next content update.
- **Effect:** If MarkdownRenderer crashes during streaming, the affected segment shows raw text instead. The app stays functional. On next content update, it auto-recovers and tries markdown rendering again.

### Fix D: Don't override thinking budget when 0 (auto) — thinking was completely disabled
- **File:** `pipeline/agenticLoop.js` L128-130
- **CHANGED:** Condition from `if (context?.params?.thinkingBudget !== undefined)` to `if (context?.params?.thinkingBudget)` (truthy check)
- **Root Cause:** Frontend defaults `thinkingBudget` to 0 (documented as "auto"). The old condition `!== undefined` evaluated to true for 0, overriding llmEngine's profile default (2048) with 0. Then llmEngine passed `budgets.thoughtTokens = 0` to node-llama-cpp, completely disabling thinking. Reasoning models like Qwen3.5 were running with zero thought budget.
- **Effect:** When `thinkingBudget` is 0 (auto), the override is skipped. llmEngine's profile-based default (2048) or model-specific detection takes effect. Non-zero values (-1 unlimited, >0 specific) still override as intended.

### Fix E: Default thinking display to expanded
- **File:** `frontend/src/components/ChatPanel.jsx` — `thinkingExpanded` state
- **CHANGED:** `useState(false)` to `useState(true)`
- **Root Cause:** Even if thinking tokens were generated, the thinking section was collapsed by default. User had to click "Thinking..." button to see the reasoning output. User expects it visible by default like VS Code.
- **Effect:** Thinking output is immediately visible during streaming without requiring user interaction.

---

## 2026-03-30 — R42: Naked Code Leak + File-Op ToolCallCard Regression (3 files, 4 fixes)

### Fix 1: resolveSuspense(false) stops killing _fileContentActive (naked code root cause)
- **File:** `pipeline/streamHandler.js` L641-650 — `resolveSuspense()`
- **REMOVED:** The `if (this._fileContentActive)` block inside `resolveSuspense(false)` that sent `file-content-end` and cleared `_fileContentActive` and `_fileContentFilePath`
- **Root Cause:** When `resolveSuspense(false)` ran (suspended content classified as text), it killed `_fileContentActive`. All subsequent tokens from the still-generating file then routed through `_flush()` as `llm-token` events, appearing as raw CSS/JS in the chat panel instead of inside FileContentBlock.
- **Effect:** `_fileContentActive` survives across suspense resolution. The agenticLoop's `endFileContent()` is the only code path that terminates file content blocks.

### Fix 2: finalize(false) respects _keepFileContentAlive flag
- **File:** `pipeline/streamHandler.js` L34 (constructor), L426 (`finalize()`)
- **ADDED:** `_keepFileContentAlive` property initialized to `false` in constructor
- **CHANGED:** `finalize(false)` condition: added `&& !this._keepFileContentAlive` guard so file content blocks survive between iterations when rotationCheckpoint is active
- **Root Cause:** `finalize(false)` at end of iteration killed `_fileContentActive` even when a rotationCheckpoint indicated file was still in progress. Next iteration's tokens went to `llm-token`.
- **Effect:** File content block stays alive across iteration boundaries when file is incomplete.

### Fix 3: rotationCheckpoint guarded by structural completeness
- **File:** `pipeline/agenticLoop.js` L2143-2152 — `fileCompletionCheckPending` handler
- **CHANGED:** Instead of unconditionally nulling `rotationCheckpoint` when model responds with no tool calls, check `_isContentStructurallyComplete()` first. If file is still incomplete, keep checkpoint alive and set `stream._keepFileContentAlive = true`. If complete, null checkpoint and clear flag.
- **Root Cause:** When model responded to completion check with prose (no tool calls), `rotationCheckpoint` was nulled unconditionally. `_r38FileIncomplete` evaluated to false, causing raw continuation content to route as text instead of file content. This caused repeated file rewrites and naked code.
- **Effect:** Incomplete files maintain their checkpoint until structurally complete, preventing premature text routing.

### Fix 4: File-operation tools no longer create ToolCallCards
- **File:** `frontend/src/App.jsx` L75-91 — `tool-executing` and `mcp-tool-results` handlers
- **ADDED:** `FILE_OPS` set containing `write_file`, `create_file`, `append_to_file`, `edit_file`, `delete_file`, `read_file`
- **CHANGED:** Both `tool-executing` and `mcp-tool-results` handlers now skip `addStreamingToolCall()` / `updateStreamingToolCall()` for tools in the FILE_OPS set
- **Root Cause:** All tools including file operations were creating ToolCallCard segments in the chat. File operations should display ONLY via FileContentBlock — the ToolCallCard with full JSON params was redundant and confusing.
- **Effect:** File-op tools no longer appear as expandable ToolCallCards. Non-file tools (web_search, etc.) still render as ToolCallCards.

---

## 2026-03-31 — R41: Pipeline Bug Fixes D1-D9 (3 files)

### Fix 1: Stop forcing continuation on completed files (D1/D3 — Emoji/Word Spam)
- **File:** `pipeline/agenticLoop.js` L67-79 — `_isContentStructurallyComplete()`
- **Root Cause:** For non-HTML/JSON/SVG/XML files, function had a `lineCount >= 50` gate — any file under 50 lines ALWAYS returned `false`. R38-Fix-C then forced up to 5 continuation retries on already-completed files. Model had nothing to say → degenerate sampling → emoji/word spam.
- **REMOVED:** `if (lineCount >= 50)` gate that required 50+ lines for general files
- **ADDED:** `if (lineCount < 3) return false` — only reject trivially short content (likely truncated). Anything 3+ lines trusts the model's eogToken as the completion signal, with structural closers (`}`, `)`, `;`) as additional confidence.
- **Effect:** R38-Fix-C no longer fires on completed short files. HTML/JSON structural checks unchanged.

### Fix 2: Enrich context shift summaries (D2/D4 — Memory Loss)
- **File:** `pipeline/nativeContextStrategy.js` L271-326 — `summarizeDroppedItems()`
- **Root Cause:** Dropped model items were summarized as action-only bullets ("Wrote task_manager.py (224 lines)") — file content structure was completely lost. After context shift, model couldn't recall what was IN the file.
- **ADDED:** 5-line content excerpt after write_file summaries: `Wrote task_manager.py (224 lines) | starts: import datetime class TaskManager...`
- **ADDED:** Brief model text summaries for non-tool-call responses (first 150 chars) — preserves conversational context that was silently dropped
- **CHANGED:** Max summary entries 12 → 15 to accommodate richer summaries
- **Effect:** Model retains structural context about files it wrote and conversational details after context shift.

### Fix 3: filePath validation before tool execution (D7 — Empty filePath EISDIR)
- **File:** `pipeline/agenticLoop.js` — before `mcpToolServer.executeTool()` call
- **Root Cause:** Model emitted write_file with empty `filePath` string. Pipeline passed it to MCP which tried to write to a directory path → EISDIR error.
- **ADDED:** Validation block: for file-operation tools (write_file, create_file, append_to_file, edit_file, read_file, delete_file), checks `effectiveArgs.filePath` is non-empty. If empty, returns error result to model with message "filePath is empty or missing" and skips execution.
- **Effect:** Empty filePath caught before hitting filesystem. Model gets actionable error message.

### Fix 4: System prompt refinement (D8/D9 — Fabricated Success, Wrong Tool)
- **File:** `constants.js` L18-79 — both `DEFAULT_SYSTEM_PREAMBLE` and `DEFAULT_COMPACT_PREAMBLE`
- **D8 Root Cause:** Model claimed "file successfully written" after tool returned an error. Prompt had no instruction to verify tool results.
- **D9 Root Cause:** Compact preamble said "Chat code blocks are ONLY for short explanations (under 30 lines). Anything longer MUST use write_file." This pushed model to use write_file for inline code discussion (e.g., explaining a bug fix).
- **ADDED (both preambles):** "After calling a tool, check the result — if the tool returned an error or failed, acknowledge the failure honestly. Do NOT claim success when the tool failed"
- **CHANGED (full preamble):** "NEVER output file content as inline code blocks" → "NEVER output entire files as inline code blocks. Short code snippets in chat for explanation are fine"
- **CHANGED (compact preamble):** Removed "Chat code blocks are ONLY for short explanations (under 30 lines). Anything longer MUST use write_file." → "When discussing, explaining, or fixing code: code blocks in chat are fine at any length. Only use write_file when the user asks you to CREATE or MODIFY a file on disk."
- **Effect:** Model can use code blocks for explanations without being pushed toward write_file. Model should verify tool results before claiming success.

---

## 2026-03-31 — R40: Tool Call Display Overhaul (4 files)

### Root Cause
Backend `streamHandler.toolExecuting(tools)` sends `[{tool, params}, ...]` as a flat array over websocket.
Frontend `App.jsx` treated `data` as a single object and read `data.functionName || data.name` — but `data` is an array and elements use `.tool` not `.functionName`. Triple mismatch = every field is `undefined` = blank tool cards.

Additionally, tool calls rendered in a standalone block above all segment content (not inline/chronological), and the card design was too thick/heavy.

### Changes

#### 1. App.jsx L73-91 — Fix array iteration + property mapping
- **REMOVED:** Single-object reads: `data.functionName || data.name`, `data.params || data.arguments`
- **ADDED:** `Array.isArray(data)` check, iterates each item, maps `.tool` -> `functionName`
- **Applies to:** `tool-executing`, `mcp-tool-results`, `tool-checkpoint` — all 3 handlers
- **Effect:** Tool cards now receive actual data (functionName, params, status, result, duration)

#### 2. appStore.js ~L193 — Tool segments + text buffer flushing
- **REMOVED:** Simple `push` in `addStreamingToolCall`
- **ADDED:** Text buffer flush before inserting tool (same pattern as `startFileContentBlock`), then `{type:'tool', toolIndex}` segment added to `streamingSegments`
- **CHANGED:** `updateStreamingToolCall` now prefers matching pending calls first (handles duplicate tool names)
- **Effect:** Tool calls appear inline chronologically with text and file blocks

#### 3. ChatPanel.jsx — Inline rendering via segments + duplicate collapse
- **REMOVED:** Standalone `streamingToolCalls.map()` block in Footer (rendered all tools above content)
- **REMOVED:** Standalone `msg.toolCalls?.map()` block in finalized messages (same issue)
- **ADDED:** `seg.type === 'tool'` handling in both streaming and finalized segment loops
- **ADDED:** Duplicate collapse logic: consecutive tool segments with same functionName render as one ToolCallCard with `count` prop (e.g., "read_file x3")
- **ADDED:** `seg.type === 'tool'` handling in finalization loop (preserves tool segments in finalized messages)
- **CHANGED:** Message creation condition: now creates message if there's text content OR tool calls (was text-only)
- **Effect:** Tools appear inline where they occurred in the conversation, not as a separate block

#### 4. ToolCallCard.jsx — Compact VS Code-style redesign
- **REMOVED:** Heavy card with shadow, rounded-lg border, separate params/result toggle buttons (~50px tall)
- **ADDED:** Single-line compact design (~28px): `[chevron] [wrench] functionName [xN count] [duration] [status]`
- **ADDED:** `border-l-2 border-vsc-accent/40` left accent bar (VS Code style)
- **ADDED:** Click anywhere on row to expand/collapse (single toggle, not separate)
- **ADDED:** `count` prop — shows `x3` badge when duplicate tool calls are collapsed
- **ADDED:** Smart duration display: `<1000ms` shows ms, `>=1000ms` shows seconds with 1 decimal
- **ADDED:** Success status shows only checkmark icon (no "Done" label) for compactness
- **Effect:** Tool cards are thin, clean, collapsible, and match VS Code's tool call pattern

---

## 2026-03-31 — R39: All 9 Defect Fixes + Visual Polish (10 files)

### Phase A: Frontend UI Fixes

#### A1. Tool Call Display (3 files)
- **appStore.js ~L123:** Added `streamingToolCalls: []` state for live tool call tracking.
- **appStore.js ~L193:** Added `addStreamingToolCall(tc)` and `updateStreamingToolCall(name, updates)` actions.
- **appStore.js ~L153:** Added `streamingToolCalls: []` to `setChatStreaming(false)` cleanup object.
- **App.jsx L73-78:** Populated empty `tool-executing`, `mcp-tool-results`, `tool-checkpoint` handlers. `tool-executing` calls `addStreamingToolCall()` with functionName, params, status, startTime. `mcp-tool-results` calls `updateStreamingToolCall()` with status/result/duration. `tool-checkpoint` merges checkpoint data.
- **ChatPanel.jsx ~L42:** Added `streamingToolCalls` state selector.
- **ChatPanel.jsx Footer:** Renders `streamingToolCalls.map(tc => <ToolCallCard>)` after generating tool spinner, before segments.
- **ChatPanel.jsx finalization ~L231:** Copies `streamingToolCalls` into `toolCalls` property of finalized assistant message.
- **Why:** ToolCallCard.jsx existed but was never fed data. Backend emitted events, App.jsx stubs were empty.

#### A2. Chat Auto-Scroll (1 file)
- **ChatPanel.jsx:** Added `virtuosoRef` ref and `atBottomRef` ref. Added `ref={virtuosoRef}` and `atBottomStateChange` callback to Virtuoso. Added useEffect watching `[chatStreaming, chatStreamingText, streamingSegments, streamingToolCalls]` — calls `scrollToIndex({index:'LAST', behavior:'smooth'})` when `atBottomRef.current` is true.
- **Why:** Virtuoso `followOutput` only fires when `data` array grows. Streaming renders in Footer — not a data item. Footer growth never triggered follow.

#### A3. Terminal Theme Sync (1 file)
- **BottomPanel.jsx XTermPanel:** Added second useEffect with MutationObserver on `document.documentElement`, watching `attributes: ['class']`. On mutation, re-reads CSS vars via `getComputedStyle` and updates `xtermRef.current.options.theme`.
- **Why:** xterm read CSS vars once on mount with deps `[activeTerminalTab]`. Theme changes never triggered re-read.

#### A4. Welcome Screen Overflow (1 file)
- **WelcomeScreen.jsx:** Changed `recentFolders.map()` to `recentFolders.slice(0, 4).map()` with "Show all (N)" link.
- SVG heights: 40%→25%, 35%→20%. Opacity: 0.06→0.03, 0.04→0.02. Animation: "30,5"→"15,3", "-20,8"→"-10,4".
- **Why:** Unlimited recent projects caused vertical overflow. Aggressive SVG animation was distracting.

### Phase B: Pipeline Fixes

#### B1. Narrative Stripping in Fix-M (1 file)
- **agenticLoop.js Fix-M path (~L2215):** After fence stripping and before append, added syntax-character-based prose detection. Uses file extension to determine syntax test regex (HTML: `<`, CSS: `{:;@`, JS: `=({;` + keywords, Python: `=({:` + keywords, JSON: `[{`, YAML: `:`). Scans first 15 lines, skips everything before first syntax-matching line.
- **Why:** After context shift, model outputs prose preamble ("I'll continue building...") that got appended to the file, corrupting CSS/HTML.

#### B2. Post-Shift Continuation Directive (1 file)
- **agenticLoop.js ~L258:** Added `let lastContextPercent = 100` tracking variable.
- **agenticLoop.js ~L520:** After `stream.contextUsage()`, computes `currentContextPercent`. If `current < last * 0.6` AND `rotationCheckpoint` active, injects strong continuation directive as `nextUserMessage`: "CONTEXT SHIFT OCCURRED. You were writing [file] ([N] lines). DO NOT restart. Continue from where you left off using append_to_file. Last content was: [tail 20 lines]. Output ONLY code."
- **Why:** After context shift, model saw compressed summary and restarted task from scratch instead of continuing.

#### B3. Fix-C Retry Improvement (1 file)
- **agenticLoop.js R38-Fix-C block (~L2290):** Enhanced continuation message with structural analysis. For HTML files, reports missing structural elements (e.g., "Missing elements: `<body>`, `</body>`, `<script>`, `</html>`"). Added "no preamble" directive.
- **Why:** Generic retry message caused model to output prose instead of code. Structural hints help model produce targeted code.

#### B4. Budget-Proportional User Message Preservation (1 file)
- **nativeContextStrategy.js `summarizeDroppedItems()`:** Replaced first-sentence extraction (`text.split(/[.!?\n]/)[0]`) with budget-proportional preservation. Counts dropped user messages, calculates `perMessageBudget = Math.max(100, Math.min(600, 3000/count))`. Keeps first N chars of each user message truncated at word boundary.
- **Why:** First-sentence-only lost names, multi-part requests, conversation context. Budget-proportional keeps everything the user said proportionally — no pattern matching, no heuristics.

### Phase C: Visual Polish (2 files)
- **index.css:** Glass card: enhanced blur (12→16px), saturate (130→140%), added box-shadow depth. Chat messages: subtle border-bottom separators. Chat code blocks: rounded-lg, inset shadow, border. Editor tabs: inset shadow on active. File tree items: border-radius 3px, margins, active inset shadow. Command palette: rounded-xl, enhanced shadow. Notification toast: rounded-xl, blur (16→20px), enhanced shadow.
- **ToolCallCard.jsx:** Added subtle box-shadow to card container.
- **Why:** User requested VS Code-level polish — depth, shadows, glassy elements, rounded edges.

---

## 2026-03-30 — R39 STRESS TEST SESSION (10 tests, no code changes)

### Test Environment
- Model: Qwen3.5-2B-Q8_0.gguf, ctx=8192, TEST_MAX_CONTEXT=8000
- GPU: RTX 3050 Ti Laptop (4096MB), ~3020MB GPU used
- Project: r39-test-01, 12 requests, 195,426 total session tokens
- Server: node server/main.js, port 3000

### Tests Ran (Tests 1-4: prior session; Tests 5-10: this session)

#### Test 5 — Python Code Generation
- Prompt: Write a Python TaskManager class with CRUD, type hints, docstrings, validation, unit tests
- Result: **PASS** — Two files generated (task_manager.py: 224 lines, test_task_manager.py: 203 lines)
- Context went 71% → context shift → 56% — monotonic file growth maintained
- No emoji spam, generation completed cleanly

#### Test 6 — Architecture Recall (Context Shift Recall)
- Prompt: Explain the architecture of the TaskManager class you just wrote
- Result: **FAIL** — D4: model said "I cannot answer this question directly because I don't have a live view of the codebase"
- Claimed task_manager.py "does not exist" — hallucinated that it previously wrote a JavaScript class
- Root: Context shift after Test 5 dropped all tool results + generated code from active context
- Model should have used read_file but instead fabricated a JavaScript backstory and asked user to run commands

#### Test 7 — Multi-Tool Chain (web_search + write_file + list_files)
- Prompt: Search for current Python version, create python-version.txt, list src folder
- Result: **PARTIAL PASS** — all 3 tools used correctly in sequence
- D5: python-version.txt contained the model's entire chat response appended to file content (conversational text leaked into file body). Written 3× (duplicate summaries in file)
- D6: Python version reported as 3.10.4 (incorrect; 3.13.x is current stable) — web search returned stale source
- Tool chain mechanics: PASS; output quality: FAIL

#### Test 8 — Bug Fix Task
- Prompt: Fix ZeroDivisionError in calculate_average() when list is empty
- Result: **PASS (reasoning) / FAIL (execution)** — model identified correct fix (`if not numbers: return 0`)
- D7: Model attempted write_file/edit_file with empty filePath → EISDIR error → duplicate call → stuck detector
- D8: After stuck+blocked, model said "The file has been successfully written" — fabricated success after failure
- D9: Model tried to write_file for inline code in chat — should have just replied in chat text

#### Test 9 — Rapid-Fire Short Questions
- Q1: "What is 15 times 15?" → **225** — CORRECT
- Q2: "What programming language is React written in?" → **JavaScript** — CORRECT
- Q3: "Name the three laws of robotics by Isaac Asimov" → First two laws correct. Third law truncated ("A robot must self-preserve" instead of "...as long as...First or Second Law"). Hallucinated note added to First Law.
- Overall: PASS with minor quality issue

#### Test 10 — Final Context Recall (B4/Long-History Test)
- Prompt: "Do you remember the e-commerce project from the beginning of our conversation? What was Phase 1 and what database did you recommend?"
- Result: **PARTIAL PASS** — model responded "Yes, I remember our e-commerce project! Phase 1 was basic structure + in-memory products/orders schema, moving toward PostgreSQL or MySQL"
- Context at this point: entries=2 (system prompt + user message only) — history completely compressed
- Model answered correctly but from rolling summary, not raw history
- Context shift did preserve the key project details

### Defects Found This Session

#### D4 — Context Shift Drops Tool Results + Generated Code
- After Tests 5→6: model lost all tool results from the prior iteration, including the write_file confirmation and the code it generated
- Instead of using read_file to look up what it wrote, it fabricated a JavaScript story and asked user to run commands
- Root: Rolling context summary does not preserve tool call results; it only summarizes conversation text

#### D5 — Chat Response Text Leaked into File Body
- Test 7: python-version.txt contained model's chat response text appended to the file ("Now let me list all the files", "I've completed all three tasks", etc.)
- File written 3× with duplicate summary paragraphs
- Root: Model treated file content and chat response as one stream, did not distinguish them

#### D6 — Stale Web Search Result
- Python version reported as 3.10.4 (not 3.13.x current stable). Source: bairesdev.com blog
- Minor note: web_search tool may not be prioritizing authoritative sources (python.org)

#### D7 — write_file/edit_file Called with Empty filePath
- Test 8: Model called edit_file({"filePath":"","oldText":""}) and write_file({"filePath":""}) — empty path
- EISDIR error, then R32-Fix Phase B blocked duplicate, then stuck detector fired
- Root: User gave inline code in chat (not referencing a file). Model should not attempt file operations; should explain fix in chat.

#### D8 — Fabricated Success After Tool Failure
- After write_file failed (empty filePath, EISDIR, blocked duplicate), model said "The file has been successfully written."
- This is a lie. The model fabricated task completion for an operation that failed 3 times.
- Root: Final iteration generated text saying success without verifying actual tool results

#### D9 — Inappropriate Tool Use for Inline Code
- Test 8: User provided code snippet inline in chat. Model attempted file operations instead of inline explanation.
- Correct behavior: reply in chat text with the fix, no file needed

### Confirmed From Prior Session (D1-D3)
- D1: R38-Fix-C false positive on completed files → emoji spam loop (5 retries, NativeCtxShift failure at 92%)
- D2: Context shift drops user introduction — "Marcus" was lost, model fabricated "sessions are isolated" excuse
- D3: Response degeneration — application table list continues into PostgreSQL system catalog spam

### What Worked Well
- Basic arithmetic: 7×83, 15×15 — all correct
- Short factual questions (React language, Asimov laws): mostly correct
- Multi-file code generation (Test 5): clean, monotonic growth, no spam
- Multi-tool chain mechanics (Test 7): all 3 tools called in correct sequence
- Context at 195K tokens, 12 requests — server stable, no crashes

---

## 2026-03-30 — R38 TEST RESULTS (no code changes)

### Test Environment
- Model: Qwen3.5-2B-Q8_0.gguf, ctx=8192, TEST_MAX_CONTEXT=8000
- GPU: RTX 3050 Ti Laptop (4096MB), 25/32 layers offloaded
- 5 messages sent, 9 iterations across responses

### Conversational Tests (Messages 1-4)
- **Tool calling works**: web_search called correctly for weather, results integrated
- **StreamHandler tool hold works**: properly held fenced JSON, finalized on real tool call
- **Math computation correct**: 287 x 43 = 12,341
- **Name recall FAILED**: model forgot "Brendano" by message 4 (told in message 1, used in response 1)
- **Multi-item coverage**: model consistently skipped some items (Ravencoin search, programming languages question)
- **Hallucination**: Maine fun fact completely fabricated (Lake Champlain in Maine, extinct volcano in Acadia)
- **UI auto-scroll broken**: responses 3 and 4 not visible without manual scroll/click

### Periodic Table Stress Test (Message 5 — Context Rotation)
- Iterations 1-7: CSS generated via content-streaming, accumulated 6924 chars (237 lines)
- R38-Fix-C exhausted 5/5 structural completion retries (file never reached HTML body)
- **Context shift triggered at iteration 8** (62.5%, 5116/8192 tokens)
- **After shift: model RESTARTED task** — "I need to create the complete HTML file..." — produced 2186 chars from scratch
- **Rotation protection WORKED**: detected new<existing (2186<6924), blocked regression
- File on disk: 6924 bytes, CSS only, no HTML body/JS/data, corrupted at boundaries
- Corruption: narrative text leaked into CSS ("rgbaI'll continue building the periodic table...")

### Scored (8 criteria from RULES.md)
1. Context shifts at least once: PASS
2. File COMPLETES with closing tags: FAIL
3. ONE coherent code block in UI: PARTIAL
4. Content coherent across context shifts: FAIL
5. Line count grows monotonically: PASS (rotation protection)
6. No duplicate content at boundaries: FAIL (narrative leak)
7. No raw JSON leaking: PASS
8. No "undefined" or artifact text: FAIL (continuation preamble in CSS)

### Mechanisms That Worked
- Tool detection + execution (web_search)
- StreamHandler tool hold/finalization
- Rotation protection (blocked file regression)
- R38-Fix-C structural completion check (detected incomplete file)
- Pre-gen compression + post-loop compaction + summarization

### Mechanisms That Failed
- Model recall after context shift (restarts task from scratch)
- Content-stream boundary handling (narrative leaks into file content)
- Structural completion retry budget (5 not enough for large file)
- Chat auto-scroll (responses not visible)

### Known Defects for Next Session
- D1: Boundary corruption — continuation preamble text concatenated into file content
- D2: Model restarts task after context shift instead of continuing
- D3: Chat auto-scroll fails for responses (messages 3, 4 invisible)
- D4: Name recall fails across conversation (dropped from context/summary)
- D5: R38-Fix-C retry budget (5) insufficient — doesn't help if model can't fit the file in context

---

## 2026-03-30 — FEATURE SPRINT: UI/UX Overhaul (7 files)

### 1. Model Persistence (server/main.js)
- **L259-270:** Added `settingsManager.set('lastModelPath', modelPath)` after successful `llmEngine.initialize()` in `/api/models/load` handler.
- **L1010-1020:** Startup auto-load rewritten — checks `settingsManager.get('lastModelPath')` first, finds matching model in scan results, falls back to `modelManager.getDefaultModel()` only if no lastModelPath.
- **Why:** Model selection was lost on restart. Users had to re-select every time.

### 2. Message Queue Completion (frontend/src/components/ChatPanel.jsx)
- **handleSend refactor:** Split into `doSend(text)` (core logic, explicit text param) + `handleSend` wrapper (reads `input` state) + `handleSendQueued` wrapper (takes explicit text for queue).
- **handleKeyDown:** Added `else if (e.key === 'Enter' && e.shiftKey && chatStreaming)` — queues message via `addQueuedMessage(input.trim())`, clears input.
- **useEffect (queue auto-process):** Watches `chatStreaming` via `prevStreamingRef`. When streaming transitions true→false, auto-dequeues first item and calls `handleSendQueued(next.text)` after 500ms delay.
- **Why:** Store + UI for message queue existed but nothing triggered `addQueuedMessage`. Shift+Enter during streaming now queues, and auto-processing dequeues when ready.

### 3. Hamburger Menu (frontend/src/components/TitleBar.jsx — complete rewrite)
- **Removed:** Old `MenuDropdown` component with individual dropdown menu buttons.
- **Added:** Single hamburger `<Menu>` icon toggle. Panel: `absolute top-titlebar`, `backdrop-blur-xl`, `rounded-lg shadow-2xl w-[280px]`. Categories expand/collapse via `expandedCat` state with rotating chevron. Items show keyboard shortcuts.
- **Preserved:** `MENUS` array, `executeMenuAction`, `WinBtn` — all unchanged.
- **Why:** Individual dropdown menus cluttered the title bar and didn't match modern IDE aesthetics.

### 4. Search Bar in Title Bar (frontend/src/components/TitleBar.jsx — same rewrite)
- **Added:** Center area contains file search instead of static project name.
- **State:** `searchActive`, `searchQuery`, `searchInputRef`.
- **Memos:** `flatFiles` recursively flattens `fileTree` into `[{name, path, fullPath}]`. `searchResults` filters by query, max 12 results.
- **Ctrl+P:** Global keyboard shortcut via useEffect activates search.
- **Store subscriptions added:** `fileTree`, `openFile`.
- **Why:** No quick file navigation existed. Ctrl+P is standard in every IDE.

### 5. Welcome Screen Redesign (frontend/src/components/WelcomeScreen.jsx — complete rewrite)
- **Background:** Two overlapping wavy SVG paths with `<animateTransform>` (8s and 10s cycles), radial accent glow behind logo.
- **Entrance animations:** `mounted` state + `anim(delay)` helper for staggered opacity+translateY.
- **Logo:** w-20 h-20, pulsing radial glow overlay, text-shadow on brand name.
- **Buttons:** rounded-xl, hover:brightness-110, hover:shadow-lg with accent shadow.
- **Cards:** `glass-card` CSS class for glassmorphism effect.
- **Why:** Old welcome screen was plain/functional with no visual impact.

### 6. Recommended Models (frontend/src/components/WelcomeScreen.jsx — same rewrite)
- **Added:** `RECOMMENDED_MODELS` constant — 3 Qwen 3.5 variants (4B starter/green, 9B recommended/accent with "Best" badge, 32B advanced/purple).
- **Download:** `downloadRecommended()` constructs HuggingFace URL, calls `/api/models/download`.
- **State:** `downloadingRec` tracks active download. `alreadyInstalled` checks against `llmModels`.
- **Why:** New users had no guidance on which models to download.

### 7. App-Wide Visual Polish (frontend/src/index.css, frontend/src/components/Layout.jsx)
**index.css changes:**
- **Added:** `glass-card` class — `rgba(255,255,255,0.025)` bg, `rgba(255,255,255,0.06)` border, `blur(12px) saturate(130%)` backdrop-filter, hover state.
- **Activity bar icons:** Changed from `hover:text-bright + duration-100` to `transition-all duration-150` with bg hover (`list-hover/0.6`). Active indicator: rounded, `h-5` (was h-6), accent glow shadow.
- **Sidebar:** Section header gets `transition-colors duration-150`. File tree items get `border-left: 2px solid transparent` that highlights accent on hover, solid accent when active.
- **Panel tabs:** Changed from `border-b-2 border-transparent` to gradient `border-image` on active tab using `linear-gradient(90deg, accent, accent-hover)`.
- **Status bar items:** Added `border-right: 1px solid panel-border/0.3` dividers between items, `:last-child` removes it. Duration 75ms→100ms.
- **Splitters:** Replaced flat `hover:bg-accent` with gradient: `linear-gradient(180deg, transparent, accent/0.5, transparent)` on hover, solid accent on active. Removed old `::after` pseudo-element overlay.
- **Command palette overlay:** Added `backdrop-filter: blur(4px)`. Palette box: `rounded-lg` (was rounded-md), refined box-shadow with white glow ring.
- **Notification toast:** Added `backdrop-filter: blur(16px)`, `rounded-lg`, refined shadow.

**Layout.jsx changes:**
- **Model loading overlay:** Added inline `backdropFilter: blur(16px)`, glassmorphic background `rgb(sidebar/0.9)`, refined shadow, `rounded-xl`, gradient progress bar using `linear-gradient(90deg, accent, accent-hover)`, wider bar `w-44` (was w-40).

---

## 2026-03-30 — R38: STATE-BASED ROUTING + STRUCTURAL COMPLETION (2 files)

### Files changed: pipeline/agenticLoop.js, mcpToolServer.js

**Root cause (D1 — second code block):** The R35-L2 suspended content routing and Fix-M both used keyword heuristics (`looksLikeCode` / `looksLikeProse`) to decide whether raw output was file continuation or prose. The `looksLikeProse` regex matched `I've` at the start of suspended content, causing 2556 chars of JS file continuation to be classified as prose and sent as `llm-token` — producing a second code block in the UI. Meanwhile, Fix-M independently re-classified the same generation's `rawText` (2366 chars) as code and appended to disk. Two systems making independent binary decisions about the same content using the same unreliable keyword regex.

**Root cause (D2 — incomplete file on disk):** When the model emitted eogToken in iter 3, `shouldContinue()` returned false (not maxTokens). The loop exited without checking structural completeness. The function `_isContentStructurallyComplete` exists (tests for `</html>` at end of HTML files) but was only used in R36-Phase4 (blocking new file writes during continuation), never at the loop exit point.

**Root cause (D3 — leading "/" in HTML file):** The model's JSON output included `\/` before `<!DOCTYPE html>`, which `JSON.parse` correctly unescaped to `/<!DOCTYPE html>`. No valid HTML starts with a non-whitespace character before `<!DOCTYPE`.

**Fix A — State-based routing replaces keyword heuristics (agenticLoop.js ~L2120-2220):**
- REMOVED: `suspLooksLikeCode`, `suspLooksLikeProse` regex from R35-L2 block
- REMOVED: `looksLikeCode`, `looksLikeProse` regex from Fix-M block
- REMOVED: `prosePatterns` trailing prose stripping regex from Fix-M block (R35-L3)
- ADDED: `_r38FileIncomplete` — single state check using `rotationCheckpoint` existence AND `_isContentStructurallyComplete()` return value
- ADDED: `_r38DiskHandled` flag — prevents double-append when both suspense resolution and Fix-M fire for the same generation
- When file is incomplete: suspended content routes as file content unconditionally. No keyword detection.
- When file is complete or no checkpoint: suspended content routes as text.
- Fix-M only fires when suspense resolution didn't already handle the disk append.
- Overlap detection and envelope extraction preserved (structural, not keyword-based).

**Fix B — Structural completeness check at loop exit (agenticLoop.js ~L2230):**
- ADDED: After R38 suspended/Fix-M processing, before natural completion exit: if `rotationCheckpoint` exists AND `result.stopReason === 'natural'` AND `!_isContentStructurallyComplete(...)`, force continuation with `append_to_file` directive.
- ADDED: `eogStructuralRetries` counter (max 5) as infinite loop safety.
- Continuation message instructs model: "output ONLY code — no commentary."
- Observable: model gets re-prompted to finish the file instead of the loop ending with incomplete content.

**Fix C — HTML content sanitization (mcpToolServer.js _writeFile ~L1378):**
- ADDED: For `.html`, `.htm`, `.xhtml` files, strip a single stray non-whitespace character before `<!DOCTYPE`. Regex: `/^[^<\s](<!\s*DOCTYPE)/i` → `$1`.
- Observable: leading `/` before `<!DOCTYPE html>` is stripped on write.

**Keyword patterns remaining in codebase (not addressed in R38):**
- R36-Phase5 in salvage content path (~L1139): trailing prose stripping regex. This is a content cleanup filter inside the tool call extraction path, not a routing gate. Different concern.
- The R26-D6 give-up pattern (~L2013) uses a keyword regex to detect model "I cannot complete" messages. This is an intent detection (did the model refuse?) not a code/prose classification. Different concern.

---

## 2026-03-30 — R37-Fix: FINALIZE/SUSPENSE ORDERING BUG (2 files)

### Files changed: pipeline/streamHandler.js, pipeline/agenticLoop.js

**Root cause:** `finalize(false)` killed `_fileContentActive` BEFORE `resolveSuspense()` ran. In iter 2 (raw continuation, no tool call), 6530 chars of CSS/JS were buffered in `_suspenseBuffer`. When `finalize(false)` fired, the R37-Step3 guard `!_contentResuming` was insufficient — `_contentResuming` is only set by `continueToolHold()` (tool call continuations), not raw continuations. So `finalize()` sent `file-content-end` and set `_fileContentActive = false`. Then `resolveSuspense(true)` found `_fileContentActive = false` and routed 6530 chars as `llm-token` — producing naked code in chat. The same content never reached disk, creating a gap in the file.

**Defects traced to this bug (3):**
1. Naked code (planet data, JS click handlers) displayed as plain text in chat
2. Second code block ("CSS 27 LINES") created because `_fileContentActive` was false in iter 3
3. File on disk missing iter 2 content — line 192 has `translateX(-5: 95, atmosphere:` (iter 1 tail spliced to iter 3 head)

**Fix 1 — streamHandler.js `finalize()` (line 422):**
- OLD: `if (!isToolCall && this._fileContentActive && !this._contentResuming)`
- NEW: `if (!isToolCall && this._fileContentActive && !this._contentResuming && !this._suspenseMode)`
- When `_suspenseMode` is true, there's pending content that hasn't been resolved. `_fileContentActive` must stay alive.

**Fix 2 — streamHandler.js `resolveSuspense()` (line 625):**
- OLD: Both code and prose paths left `_fileContentActive` unchanged
- NEW: When resolving as prose (not file content), end the file block: send `file-content-end`, set `_fileContentActive = false`. When resolving as file content, leave `_fileContentActive` alive.

**Fix 3 — agenticLoop.js suspense resolution block (line 2130):**
- OLD: `stream.resolveSuspense(true)` only sent content to frontend via `file-content-token`
- NEW: After `resolveSuspense(true)`, also append the suspended content to disk via `mcpToolServer.executeTool('append_to_file', ...)` and update `rotationCheckpoint.content`. Without this, the frontend shows the content but the file on disk remains incomplete.

---

## 2026-03-30 — R37: 8 STREAMING DEFECTS — ROOT CAUSE FIXES (5 files)

### Files changed: pipeline/streamHandler.js, frontend/src/stores/appStore.js, frontend/src/components/StatusBar.jsx, frontend/src/components/chat/FileContentBlock.jsx

**Step 1-2 — Non-fenced continuation release + raw continuation routing (streamHandler.js)**
- OLD: The 80-char hold release only fired for `_holdingFenced === true`. Non-fenced tool call responses had no release threshold — tokens piled up indefinitely causing the "freeze then wall of code" defect.
- NEW: `holdLimit = _holdingFenced ? 80 : 100` — non-fenced accumulates to 100 chars then releases. Added raw continuation routing: when `_contentResuming && _fileContentActive`, tokens route to `file-content-token` instead of `llm-token`.
- Root cause addressed: defects "content stuck at 37 lines" and "wall of code appearing suddenly".

**Step 3 — Preserve _fileContentActive in finalize() (streamHandler.js)**
- OLD: `finalize(false)` between continuation iterations always called `endFileContent()`, clearing `_fileContentActive`. Next iteration had no knowledge of the active file block.
- NEW: Added `&& !this._contentResuming` guard — finalize only ends the file block if NOT in a continuation. `_contentResuming` is true between iterations.
- Root cause addressed: defect "3 separate code blocks for same file across iterations".

**Step 4 — Frontend block merging in startFileContentBlock (appStore.js)**
- OLD: Every call to `startFileContentBlock` unconditionally appended a new block+segment to the array, even if the same filePath was already streaming.
- NEW: `existingIdx = findIndex(b => b.filePath === filePath && !b.complete)`. If found, returns early — no duplicate block created.
- Root cause addressed: defect "duplicate code blocks for same file".

**Step 5 — tok/s counter measures both data channels (StatusBar.jsx)**
- OLD: tok/s only measured `chatStreamingText.length`. During file generation, streaming text arrives on the `file-content-token` channel (not `llm-token`), so `chatStreamingText` stays near zero — tok/s read 0 or near-0 during file writing.
- NEW: Sum = `chatStreamingText.length + sum of all streamingFileBlocks[i].content.length`.
- Root cause addressed: defect "tok/s shows 0 during file generation".

**Step 6 — CSS content sniffing (streamHandler.js)**
- OLD: The content-type sniffer had patterns for HTML, Python, JavaScript, C, JSON, YAML — but NOT CSS. CSS files defaulted to label "text".
- NEW: Added CSS pattern `/^(?::root|html|body|\*|@charset|@import|@font-face|@media|@keyframes|\.[\w-]|#[\w-])/` placed before Python/JS patterns.
- Root cause addressed: defect "CSS file displayed as 'file TEXT' label".

**Step 7 — Deferred filePath resolution (analyzed, deemed unnecessary)**
- Analysis showed the existing code already gates `_streamFileContent()` on `contentMatch` being found. With Step 6's CSS pattern fix covering the label issue, no additional code change needed.

**Step 8 — Expanded state lifted to Zustand store (FileContentBlock.jsx + appStore.js)**
- OLD: `userExpandedRef = useRef(false)` and `expanded = useState(false)` were component-local. When the component unmounted/remounted between continuation iterations, both reset to false — "Show More" click had no effect (user clicks expand, component remounts, state resets to collapsed).
- NEW: `fileBlockExpandedStates: {}` added to appStore, with `setFileBlockExpanded(key, val)` action. FileContentBlock reads `expanded = useAppStore(state => state.fileBlockExpandedStates[filePath])` — survives any number of remounts because state is in the global store.
- Root cause addressed: defect "Show More broken during streaming".

**Step 9 — Tail visibility padding (FileContentBlock.jsx)**
- OLD: In collapsed+streaming mode the 48px gradient + 32px "Show more" button (~80px total) overlay sat at the bottom of the 240px scroll container. Auto-scroll put the newest content at the very bottom — hidden under 80px of overlay elements.
- NEW: `preStyle = (isCollapsed && !complete) ? { paddingBottom: '80px' } : undefined` applied to `<pre>`. The 80px padding pushes scroll bottom below the actual last text line, so `scrollTop = scrollHeight` positions the last line above the gradient.
- Root cause addressed: defect "collapsed view doesn't show newest streamed lines".

---



### Changes to server/main.js

**What was changed (lines ~170-182):**
- OLD: `firstRunSetup.registerRoutes(app)`, `autoUpdater.registerRoutes(app)`, `accountManager.registerRoutes(app)`, `licenseManager.registerRoutes(app)` were called immediately after each constructor — BEFORE `const app = express()` was declared (line ~235). This caused a `ReferenceError: Cannot access 'app' before initialization` (TDZ error) and the server crashed silently on startup.
- NEW: Removed `.registerRoutes(app)` from the constructor section. Moved all four calls to AFTER `const app = express()` and `registerTemplates(app)`, grouped under a "Module Routes" comment block.

**Why:** The 4 modules added in the previous session (firstRunSetup, autoUpdater, accountManager, licenseManager) each had `.registerRoutes(app)` called before `app` was declared with `const`. JavaScript `const` creates a temporal dead zone — referencing the variable before its declaration throws a ReferenceError. The server printed "Initializing pipeline components..." then exited with no visible error (swallowed by the process).

---

## 2026-03-30 — Rate limiting upgrade flow, Code block preview, OAuth fix, Registration

### Changes to ChatPanel.jsx

**What was added (lines ~162-190):**
- After `invoke('ai-chat')` returns, checks `result?.isQuotaError || result?.error === '__QUOTA_EXCEEDED__'`
- Fetches `/api/license/status` to check if user has an account
- Adds a chat message with `quotaExceeded: true, needsAccount: true/false` flag
- Returns early (skips finalization) so no empty message appears

**What was added (lines ~810-870):**
- New `QuotaExceededPrompt` component renders inside assistant messages when `msg.quotaExceeded` is true
- If `needsAccount`: shows "Create Account" button that navigates to Account panel
- If has account: shows "Upgrade to Pro" button that calls POST `/api/stripe/checkout` and opens Stripe URL
- Also shows "Use Local Model" button that navigates to models panel
- Styled with amber border/background to stand out

**What was changed (lines ~495-510):**
- Assistant message rendering now checks `msg.quotaExceeded` first, renders `QuotaExceededPrompt` instead of normal content

### Changes to CodeBlock.jsx

**What was added:**
- Import: `Play`, `Code` icons from lucide-react
- `RENDERABLE_LANGUAGES` set: html, css, javascript, js, jsx, svg, xml
- `rendering` state (boolean toggle)
- `isRenderable` computed from language
- `buildSrcdoc()` function: wraps CSS in `<style>`, JS in `<script>`, passes HTML through directly
- Play/Code toggle button in toolbar (only shown for renderable languages)
- When rendering: shows sandboxed iframe with `srcDoc` instead of code block, auto-resizes to content
- `sandbox="allow-scripts"` — no `allow-same-origin` for security

### Changes to AccountPanel.jsx

**What was changed in handleOAuth:**
- OLD: Expected server to return user data directly from `/api/license/oauth`
- NEW: Server returns `{ success: true, url: '...' }` — now opens URL via `electronAPI.openExternal` or `window.open`
- Polls `/api/account/status` every 2 seconds (up to 60 attempts / 2min) waiting for auth to complete
- Shows "Waiting for sign-in to complete..." during poll
- Cleans up poll interval on unmount

**What was added:**
- `name` state for registration
- `oauthPollRef` for cleanup
- `handleRegister()` function: calls POST `/api/account/register` with email, password, name
- Third tab "Register" with `UserPlus` icon alongside "Sign In" and "Key"
- Register form: name (optional), email, password fields + "Create Account" button
- Bottom link toggles between "Don't have an account? Create one" and "Already have an account? Sign in"

### Changes to accountManager.js

**What was added:**
- `register(email, password, name)` method: POST to `api.graysoft.dev/auth/register`, creates session on success
- `POST /api/account/register` route in `registerRoutes()`

**Why:** User identified 5 integration gaps: (1) quota exceeded returns `__QUOTA_EXCEEDED__` but frontend had zero handling — now shows upgrade prompt with account-aware flow, (2) OAuth buttons returned a URL but never opened it — now opens in browser and polls for completion, (3) no registration endpoint — now added, (4) no play/render on code blocks — now HTML/CSS/JS code blocks have a Play toggle, (5) browser preview deferred to next session.

---

## 2026-03-30 — licenseManager.js: License validation + Stripe integration

### New file: licenseManager.js (root)

**What was added:**
- `LicenseManager` class extending EventEmitter
- `activateKey(key)` — validates GUIDE-XXXXX format, verifies with api.graysoft.dev/license/activate
- `activateAccount()` — activates license via account session token
- `deactivate()` — clears license state
- `createCheckoutSession(plan)` — creates Stripe checkout session for pro/team plans
- `checkSubscription()` — checks subscription status via API
- `getPlan()` / `hasFeature(feature)` — plan-based feature gating
- `_validateStoredLicense()` — checks expiry and machine binding on startup
- `registerRoutes(app)` — 4 routes: POST /api/license/activate, POST /api/stripe/checkout, GET /api/stripe/subscription, GET /api/license/plans
- PLANS constant with free/pro/team tiers and feature lists
- Machine-specific license binding (same machineId as accountManager)
- Persistent license storage via settingsManager

### Changes to settingsManager.js

- Added `licenseData: null` to SETTINGS_DEFAULTS

### Changes to server/main.js

- Added import: `const { LicenseManager } = require('./licenseManager')`
- Instantiated `licenseManager` with settingsManager + accountManager
- Called `licenseManager.registerRoutes(app)`
- Replaced inline `licenseManager` stub in ctx with actual `licenseManager` instance
- Removed old `POST /api/license/activate` stub route (now handled by licenseManager)
- Updated `GET /api/license/status` to include `plan` from licenseManager.getPlan()
- Updated `POST /api/license/deactivate` to call licenseManager.deactivate()

**Why:** licenseManager was listed in FEATURE_COMPARISON.md as missing. The old inline stub always returned "License server not yet connected". Now the system validates license keys with format checking, verifies with the API, supports Stripe checkout for plan upgrades, persists license data, and validates machine binding + expiry on startup.

---

## 2026-03-30 — accountManager.js: Account/Auth system

### New file: accountManager.js (root)

**What was added:**
- `AccountManager` class extending EventEmitter
- `loginWithEmail(email, password)` — POST to `api.graysoft.dev/auth/login`
- `getOAuthURL(provider)` — generates OAuth redirect URL with CSRF state
- `completeOAuth(code, state)` — completes OAuth callback with state verification
- `refreshSession()` — refresh token via API
- `logout()` — clears session and persisted state
- `getSessionToken()` — returns current JWT
- Machine ID generation (SHA256 of hostname+username+platform+arch)
- Session persistence via settingsManager (sessionToken + accountUser)
- `registerRoutes(app)` — 6 Express routes: status, login, oauth/start, oauth/callback, logout, refresh

### Changes to settingsManager.js

- Added `sessionToken: null` and `accountUser: null` to SETTINGS_DEFAULTS (Account section)

### Changes to server/main.js

- Added import: `const { AccountManager } = require('./accountManager')`
- Instantiated `accountManager` with `settingsManager`, called `registerRoutes(app)`
- Updated `ctx.licenseManager` to delegate `isAuthenticated`, `getSessionToken()`, `machineId` to accountManager
- Updated `GET /api/license/status` to include `user` from accountManager
- Updated `POST /api/license/oauth` to use accountManager.getOAuthURL instead of stub error
- Updated `POST /api/license/deactivate` to call accountManager.logout()

**Why:** Account/Auth system was listed in FEATURE_COMPARISON.md as missing. The AccountPanel frontend already existed with OAuth buttons and login forms, but all API calls returned stub errors. Now the backend has real auth flow connecting to api.graysoft.dev. App still works 100% offline — auth is only needed for cloud AI proxy and licensing.

---

## 2026-03-30 — ragEngine.js: BM25 codebase search engine

### New file: ragEngine.js (root)

**What was added:**
- `RAGEngine` class — fully offline BM25-based codebase search
- `indexProject(projectPath)` — walks project tree, reads text files, builds chunk index
- `search(query, maxResults)` — BM25 scored search across 40-line overlapping chunks
- `searchFiles(pattern, maxResults)` — glob-like file path search
- `findErrorContext(errorMessage, stackTrace)` — extracts file refs from stack traces, finds relevant code
- `_fileCache` object for inline grep by mcpToolServer._grepSearch
- Respects .gitignore + built-in ignore list (node_modules, .git, binaries, etc.)
- No external dependencies, no embedding models — pure text-based retrieval

### Changes to server/main.js

- Added import: `const { RAGEngine } = require('./ragEngine')`
- Instantiated `ragEngine` before browserManager
- Changed `ragEngine: null` to `ragEngine` in ctx object
- Added `ragEngine.indexProject(resolved)` call in `/api/project/open` handler (non-blocking)

**Why:** RAG engine was listed in FEATURE_COMPARISON.md as missing. mcpToolServer._searchCodebase, ._findFiles, ._analyzeError, and ._grepSearch all check for `this.ragEngine` and return "RAG engine not available" when null. agenticChat's bug analysis also depends on it. Now all those code paths work.

---

## 2026-03-30 — autoUpdater.js: Automatic update checking and installation

### New file: autoUpdater.js (root)

**What was added:**
- `AutoUpdater` class extending EventEmitter
- Wraps `electron-updater` with graceful fallback when not installed (dev mode / web-only)
- States: idle, checking, available, downloading, downloaded, error
- `checkForUpdates()`, `downloadUpdate()`, `quitAndInstall()`, `getStatus()`
- `registerIPC(ipcMain)` — Electron IPC handlers (updater-check, updater-download, updater-install, updater-status)
- `registerRoutes(app)` — Express API routes for web UI fallback (GET /api/updater/status, POST check/download/install)
- Sends `update-status` events to renderer via `webContents.send()`

### Changes to electron-main.js

- Added import: `const { AutoUpdater } = require('./autoUpdater')`
- Instantiated `updater` after `createWindow` + `buildAppMenu`
- Called `updater.registerIPC(ipcMain)` for IPC handlers
- `setTimeout(() => updater.checkForUpdates(), 5000)` — checks 5s after launch

### Changes to preload.js

- Added `updater` namespace with: `check()`, `download()`, `install()`, `getStatus()`, `onStatus(callback)`

### Changes to server/main.js

- Added import: `const { AutoUpdater } = require('./autoUpdater')`
- Instantiated `autoUpdater` and called `autoUpdater.registerRoutes(app)`

**Why:** Auto-updater was listed in FEATURE_COMPARISON.md as missing. Users need automatic updates without manually downloading installers. Uses electron-updater (standard for electron-builder) with fallback for non-Electron environments.

---

## 2026-03-30 — firstRunSetup.js: First-run onboarding backend

### New file: firstRunSetup.js (root)

**What was added:**
- `FirstRunSetup` class taking settingsManager as dependency
- `isFirstRun()` — checks `setupCompleted` setting (false by default)
- `markComplete()` — sets `setupCompleted: true`
- `getSystemInfo()` — detects GPU (via nvidia-smi), VRAM, RAM, OS, arch, CPU model/cores; cached after first call
- `recommendSettings()` — suggests gpuLayers, contextSize, maxModelGB based on detected hardware
- `applyRecommended()` — writes recommended gpuLayers + contextSize to settingsManager
- `registerRoutes(app)` — registers `GET /api/setup/status` and `POST /api/setup/complete`
- `GET /api/setup/status` returns: `{ isFirstRun, systemInfo, recommended }`
- `POST /api/setup/complete` accepts: `{ applyRecommended?: boolean, settings?: object }`, marks setup done

### Changes to settingsManager.js

- Added `setupCompleted: false` to SETTINGS_DEFAULTS (new "Setup" section)

### Changes to server/main.js

- Added import: `const { FirstRunSetup } = require('./firstRunSetup')`
- Instantiated `firstRunSetup` with `settingsManager` after settingsManager init
- Called `firstRunSetup.registerRoutes(app)` to add the 2 API endpoints

**Why:** The firstRunSetup was listed in FEATURE_COMPARISON.md as missing. This provides the backend for an onboarding wizard: detects hardware, recommends model size and context settings, and tracks whether setup has been completed so the welcome screen knows to show the full wizard vs just the normal welcome.

---

## 2026-03-30 — browserManager.js + BrowserPanel.jsx: Live preview system

### New file: browserManager.js (root)

**What was added:**
- `BrowserManager` class extending EventEmitter for browser preview lifecycle
- `startPreview(projectPath)` / `stopPreview()` / `reloadPreview()` — delegates to liveServer
- `navigate(url)` — Playwright navigation or iframe URL change
- `launchPlaywright()` / `closePlaywright()` — optional Playwright integration (graceful fallback if not installed)
- `screenshot()` / `getSnapshot()` / `click()` / `evaluate()` — Playwright automation methods
- `dispose()` — cleanup on shutdown

### New file: frontend/src/components/BrowserPanel.jsx

**What was added:**
- React component with URL bar (back/forward/reload/external link buttons)
- Start/stop preview buttons wired to `/api/preview/start` and `/api/preview/stop`
- iframe for live preview with dynamic src
- Empty state UI with launch prompt
- Auto-starts preview on mount when projectPath exists

### Changes to server/main.js

- Added import: `const { BrowserManager } = require('./browserManager')`
- Instantiated `browserManager` with `liveServer` and `mainWindow`
- Updated `ctx.browserManager` from `null` to actual `browserManager` instance
- Added 4 new API routes: `POST /api/preview/start`, `POST /api/preview/stop`, `POST /api/preview/reload`, `GET /api/preview/status`
- Added `browserManager.dispose()` to SIGINT graceful shutdown handler

### Changes to frontend/src/components/Sidebar.jsx

- Added import of `BrowserPanel`
- Added `case 'browser': return <BrowserPanel />;` to panel switch

### Changes to frontend/src/components/ActivityBar.jsx

- Added `Globe` icon import from lucide-react
- Added `{ id: 'browser', icon: Globe, label: 'Browser Preview' }` to activities array

**Why:** The BrowserPanel was listed in FEATURE_COMPARISON.md as missing. This adds a live preview panel with hot-reload support via the existing liveServer, plus optional Playwright integration for AI-driven browser automation via mcpBrowserTools.

---

## 2026-03-30 — gitManager.js: Centralized Git wrapper class

### New file: gitManager.js (root)

**What was added:**
- `GitManager` class wrapping all git CLI operations via `execFileSync` (no shell injection)
- Methods: `getStatus()`, `stageAll()`, `stageFiles()`, `unstageAll()`, `unstageFiles()`, `commit()`, `getDiff()`, `discardFiles()`, `getLog()`, `getBranches()`, `checkout()`, `stash()`, `push()`, `pull()`, `init()`
- All methods accept optional `cwd` override parameter

### Changes to server/main.js

- Added import: `const { GitManager } = require(...)` (line ~122)
- Instantiated `gitManager` and wired via `mcpToolServer.setGitManager(gitManager)` (lines ~139-140)
- `gitManager.setProjectPath(resolved)` called in `/api/project/open` handler
- ALL 8 git API routes (status/stage/unstage/commit/discard/diff/log/branches/checkout) rewritten to delegate to `gitManager.*` methods instead of inline `execSync` calls
- Security improvement: raw `execSync` with string interpolation replaced by `execFileSync` with argument arrays (no shell injection possible)

**Why:** The inline `execSync` git calls in main.js used string concatenation which was vulnerable to shell injection via crafted filenames or branch names. gitManager uses `execFileSync` with separate argument arrays. Also: `mcpToolServer.setGitManager()` was being called with `null` — AI tool calls for git operations always returned "Git manager not available". Now they work.

---

## 2026-03-30 — appMenu.js: Electron native menu with IPC bridge

### New file: appMenu.js (root)

**What was added:**
- `buildAppMenu(mainWindow)` function
- Full native Electron menu matching TitleBar.jsx's custom menus: File, Edit, Selection, View, Go, Terminal, Help
- Each custom menu item sends `'menu-action'` IPC to the renderer with the action string
- Edit items (undo/redo/cut/copy/paste) use Electron's built-in `role` for native behavior
- View includes `toggleDevTools` for debugging
- `autoHideMenuBar` remains `true` — menu appears on Alt key press

### Changes to electron-main.js

- Added import: `const { buildAppMenu } = require('./appMenu');`
- Added call: `buildAppMenu(mainWindow)` after `createWindow(serverPort)` in `app.whenReady()`

### Changes to preload.js

- Added `onMenuAction(callback)` to the exposed `electronAPI`
- Listens for `'menu-action'` IPC events and forwards action string to callback

### Changes to frontend/src/App.jsx

- Added `useEffect` block (~100 lines) that listens for `window.electronAPI.onMenuAction`
- Dispatches to the same Zustand store actions that TitleBar.jsx's `executeMenuAction` uses
- Self-contained: exits early if `onMenuAction` not available (non-Electron environments)
- Notable: `openFolder` action uses `electronAPI.openFolderDialog()` (native dialog) instead of `prompt()`

**Why:** Native Electron menu enables Alt+key menu access and global accelerators (Ctrl+N, Ctrl+S, etc.) that work even when the web UI menus are not visible. Standard desktop app expectation.

---

## 2026-03-30 — settingsManager.js: Centralized settings + encrypted API key persistence

### New file: settingsManager.js (root)

**What was added:**
- `SettingsManager` class extending `EventEmitter`
- Constructor takes `userDataPath`, manages two files:
  - `settings.json` — plain JSON user preferences with full defaults schema
  - `api-keys.enc` — AES-256-GCM encrypted API key store
- Machine-specific encryption key derived via PBKDF2 (hostname + username + salt, 100K iterations)
- Methods: `get(key)`, `set(key, value)`, `getAll()`, `setAll(obj)`, `reset()`, `getApiKey(provider)`, `setApiKey(provider, key)`, `getAllApiKeys()`, `hasApiKey(provider)`, `removeApiKey(provider)`, `flush()`
- Debounced save: settings 3s, API keys 1s
- Emits `'change'` events on updates
- Static `DEFAULTS` getter for external use

### Changes to server/main.js

**Lines removed (145-163):**
- `SETTINGS_PATH` constant
- Inline `loadSettings()` function
- Inline `saveSettings()` function
- `let currentSettings = loadSettings();`

**Lines added (145-157):**
- `const { SettingsManager } = require(...)` (import, at line ~121)
- `const settingsManager = new SettingsManager(USER_DATA);`
- Startup loop that restores all persisted API keys into `cloudLLM` via `settingsManager.getAllApiKeys()`
- `let currentSettings = settingsManager.getAll();`

**`/api/settings` POST endpoint (~line 372):**
- Was: `currentSettings = { ...currentSettings, ...req.body }; saveSettings(currentSettings);`
- Now: `settingsManager.setAll(req.body); currentSettings = settingsManager.getAll();`

**`/api/cloud/apikey` POST endpoint (~line 417):**
- Added: `settingsManager.setApiKey(provider, key || '');` — persists key to encrypted store on disk

**Graceful shutdown (~line 1070):**
- Added: `settingsManager.flush();` before memoryStore/sessionStore disposal

**Why:** API keys set via cloud provider settings were stored in-memory only and lost on server restart. Settings persistence was fragile inline code with no schema or defaults. settingsManager.js centralizes both concerns with proper encryption for sensitive data.

---

## 2026-03-30 — R36: CODE BLOCK UX + CUMULATIVE COMPLETENESS + NEW-FILE BLOCKING + PROSE STRIP (2 files: FileContentBlock.jsx, agenticLoop.js)

R35 test + user's FileShot stress test revealed: (1) collapsed code block always shows top of file during streaming instead of trailing content, (2) "Show more" click does nothing during generation, (3) after context rotation, pipeline checks only the CHUNK for completeness instead of CUMULATIVE file (file already has `</html>` but pipeline injects continuation), (4) model creates brand new file (src/index.html) instead of finishing index.html after rotation, (5) model prose ("I need to continue writing...") leaked into generated file content.

### R36-Phase1: Auto-scroll collapsed code block to trailing content (FileContentBlock.jsx)

**What changed:**
- Added `scrollContainerRef` to the scrollable container div.
- Added `useEffect` that watches `content`, `complete`, and `isCollapsed`: when `!complete && isCollapsed`, sets `scrollTop = scrollHeight`.
- Changed collapsed-state `overflowY` from `'hidden'` to `complete ? 'hidden' : 'auto'` — during streaming, uses `auto` so scrollTop works. After completion, reverts to `hidden`.
- **Before:** Collapsed code block always showed `<!DOCTYPE html>` and the first lines of the file.
- **After:** During streaming, collapsed view auto-scrolls to show the latest lines being generated.

### R36-Phase2: Fix "Show more" click during active generation (FileContentBlock.jsx)

**What changed:**
- Added `userExpandedRef` (useRef) to persist expanded state across React re-renders.
- Changed `handleExpand` to call `e.stopPropagation()` and `e.preventDefault()` and set `userExpandedRef.current = true`.
- Added `useEffect` (no deps) that syncs `expanded` state from `userExpandedRef` — if user clicked expand but component was re-created during streaming, the ref preserves the intent.
- **Before:** Clicking "Show more" during streaming did nothing — the component was re-rendered by parent on every token batch, possibly resetting local state.
- **After:** `userExpandedRef` persists across re-renders. `stopPropagation` prevents Virtuoso scroll container from eating the click.

### R36-Phase3: Cumulative file completeness check for append_to_file (agenticLoop.js)

**What changed:**
- T58-Fix-A salvage completeness check (line ~1738): when `lastFileWrite.tool === 'append_to_file'`, now uses `rotationCheckpoint.content` (cumulative) instead of `lastFileWrite.params.content` (chunk only).
- R35-L1b post-context-shift check (line ~1878): same change — uses cumulative content for append_to_file.
- D6 merge path (line ~680): added `isCumulativeComplete` check using `_isContentStructurallyComplete(rotationCheckpoint.content)`. Added to finalization condition alongside `isHtmlComplete`, `isSmallAppendLoop`, `isLowProductivity`.
- **Before:** Pipeline checked only the current iteration's chunk (e.g., 17854 chars of CSS) for `</html>`. File on disk already had `</html>` at line 1128 but pipeline didn't know. Result: more content appended after closing tags, infinite continuation loop.
- **After:** Pipeline checks cumulative file content from `rotationCheckpoint`. If file is already structurally complete, uses completion path — no more continuation injection.

### R36-Phase4: Block write_file to new file when continuation active (agenticLoop.js)

**What changed:**
- Added check before tool execution: if `effectiveName === 'write_file'` and `rotationCheckpoint` exists for a DIFFERENT file that is NOT structurally complete, BLOCK the write and re-inject continuation for the original file.
- Normalizes paths (strip `./`, convert `\` to `/`) before comparison.
- Exception: if the original file IS structurally complete, allows the new write (multi-file tasks).
- **Before:** After context rotation, model lost awareness of `index.html` and started `write_file("src/index.html")` — creating a second incomplete file.
- **After:** Pipeline blocks the new write and tells model: "You have NOT finished index.html. Use append_to_file to continue." Model is forced back to the original file.

### R36-Phase5: Prose stripping on salvage-extracted content (agenticLoop.js)

**What changed:**
- After salvage content extraction (line ~1136), applies the same prose boundary regex as Fix-M R35-L3: `/\n\n\s*(I've|Here's|I need to|The file|...)/i`.
- Strips trailing prose before content becomes a tool call argument.
- **Before:** Model wrote "I need to continue writing the remaining content..." directly into `src/index.html` at line 253.
- **After:** Prose detected and stripped at salvage time. Only code content reaches disk.

---

## 2026-03-30 — R35: POST-CONTEXT-SHIFT DECISION FIX + DEFENSE-IN-DEPTH (3 files: agenticLoop.js, streamHandler.js, ChatPanel.jsx)

R34 test revealed 5 bugs: two code blocks in final message, naked plain text code between them, duplicate last 30 lines in second block labeled "PHP-TEMPLATE", prose written to file on disk. Root cause traced to agenticLoop.js post-context-shift decision logic — when model finishes writing `</html>` but hits maxTokens on JSON wrapper closing syntax, pipeline declares file INCOMPLETE and forces continuation, causing all downstream symptoms.

### R35-Phase 1: Extract `_isContentStructurallyComplete()` (agenticLoop.js, lines 46-82)

**What changed:**
- Added standalone function `_isContentStructurallyComplete(content, filePath)` after constants block.
- Checks file-type-specific structural completeness: `html/htm` → `</html>`, `svg` → `</svg>`, `xml/xhtml/xaml` → closing XML tag, `json` → `}` or `]`, general → 50+ lines + structural closer (`}`, `)`, `;`, closing tag, `// end/eof/done`).
- Replaced T58-Fix-A inline completeness check (old lines ~1700-1727) with call to new function. Behavior equivalent — just factored out for reuse.
- **Before:** Completeness logic was inline and only used in the salvage+natural path.
- **After:** Same logic available as reusable function, called from both salvage+natural path AND post-context-shift path.

### R35-Phase 2: Apply completeness check in post-context-shift block (agenticLoop.js, lines ~1878-1906)

**What changed — ROOT CAUSE FIX:**
- In the `if (lastFileWrite)` block under `if (_contextShiftFiredDuringGen && result.stopReason !== 'natural')`:
- BEFORE: Always declared file INCOMPLETE and injected continuation directive (`"use append_to_file to continue"`).
- AFTER: Calls `_isContentStructurallyComplete(writtenContent, filePath)` FIRST.
  - If content IS complete (e.g., ends with `</html>`) → uses COMPLETION path: `nextUserMessage = "File written, provide summary"`, calls `stream.endFileContent()`, sets `rotationCheckpoint = null`, sets `fileCompletionCheckPending = true`.
  - If content NOT complete → existing CONTINUATION path (unchanged).
- Log line: `R35-L1b: Post-context-shift content COMPLETE — using completion path`.
- **Before:** Model writes 807-line `dashboard.html` ending with `</html>`, hits maxTokens on JSON `}]}` → pipeline says "INCOMPLETE, use append_to_file" → model outputs duplicate code, wrong fences, prose → naked code, two code blocks, wrong labels.
- **After:** Pipeline detects `</html>` → completion path → model writes summary → single code block, no duplicates, no naked code.

### R35-Phase 3: Suspense buffer in StreamHandler (streamHandler.js, constructor + onToken + 3 new methods)

**What changed:**
- Constructor: Added `_suspenseBuffer = ''` and `_suspenseMode = false`.
- `onToken()`: Added suspense gate before `_flush()`: when `_fileContentActive && !_holdingToolCall && !_holdingFenced`, buffers tokens in `_suspenseBuffer` instead of flushing as `llm-token`. Logs "Suspense mode ACTIVATED" on first activation.
- Added 3 new methods after `endFileContent()`:
  - `hasSuspendedContent()` — returns `_suspenseBuffer.length > 0`
  - `getSuspendedContent()` — returns raw buffer string
  - `resolveSuspense(isFileContent)` — routes buffer to `file-content-token` (extends existing block) or `llm-token` (appears as text). Clears buffer and mode.
- `reset()`: Updated comment noting suspense buffer survives reset.
- agenticLoop.js integration (lines ~2057-2073): Before Fix-M, checks `stream.hasSuspendedContent()`. Heuristic: if suspended content has 5+ code characters (`{};:<>()[]#.@=`) and doesn't start with prose pattern → resolve as file content. Otherwise → resolve as text.
- **Before:** When `stream.reset()` cleared `_holdingToolCall` between iterations, iter 2 tokens with `_fileContentActive=true` fell through to `_flush()` → sent as `llm-token` → naked code in chat text.
- **After:** Tokens buffered in suspense, resolved by agenticLoop with full context about what they are.

### R35-Phase 4: Fix-M prose stripping (agenticLoop.js, lines ~2130-2155)

**What changed:**
- After overlap detection in Fix-M block, added prose boundary detection.
- Regex: `\n\n\s*(I've|Here's|The file|Created|Written|This file/creates/is|I created|I wrote|Sure|OK|Done|I'll|This dashboard/page/app/component/module)` (case-insensitive).
- If prose boundary found AND prose portion >= 20 chars AND code portion >= 50 chars → splits `contentToAppend` at boundary. Prose stripped from file content. Prose sent separately as `llm-token` (appears in chat text).
- Also strips markdown code fences from `contentToAppend` (```` ```html\n...\n``` ````).
- **Before:** Fix-M appended model's prose summary ("I've created a comprehensive...") directly to `dashboard.html` on disk. File contained HTML + prose garbage.
- **After:** Prose stripped before disk write, sent to chat as text instead.

### R35-Phase 6: Preserve FileContentBlock after finalization (ChatPanel.jsx, finalization + itemContent)

**What changed:**
- Finalization block (lines ~174-226): Now builds `messageSegments[]` and `messageFileBlocks[]` alongside `messageContent`. For text segments: pushes `{ type: 'text', content }`. For file segments: pushes `{ type: 'file', index }` into segments and `{ filePath, language, fileName, content }` into fileBlocks. Stores both on message via `addChatMessage({ content, segments, fileBlocks })`.
- `itemContent` rendering (lines ~454-472): When `msg.segments && msg.fileBlocks`, iterates segments: renders `FileContentBlock` for file segments (with `complete={true}`, getting the 2-icon header + fileName), renders `MarkdownRenderer` for text segments. Falls back to `<MarkdownRenderer content={msg.content} />` for old messages without structured data.
- **Before:** Finalization stored only `content` (string with markdown fences). MarkdownRenderer parsed fences → rendered as `CodeBlock` (5-icon header, no fileName). FileContentBlock (2-icon header, fileName) was only used during streaming.
- **After:** Finalized messages use FileContentBlock for file content, preserving the streaming appearance (2-icon header, fileName, language label).

### R35-Phase 7: Language label normalization (streamHandler.js, new static method + call site)

**What changed:**
- Added `static normalizeLanguageLabel(label, filePath)` method (lines ~645-695). Maps 45+ file extensions to canonical language names (e.g., `html` → `'html'`, `js/jsx/mjs/cjs` → `'javascript'`, `py` → `'python'`, `ts/tsx` → `'typescript'`, etc.). When the model's fence label doesn't match the file extension, overrides it. Logs the override.
- Applied in `_streamFileContent()` (line ~310) after content sniffing and before `file-content-start` event: `fenceLabel = StreamHandler.normalizeLanguageLabel(fenceLabel, fp)`.
- **Before:** Model wrote `html` file but fence label was `php-template` (from model hallucination). Label passed through as-is to frontend → code block labeled "PHP-TEMPLATE".
- **After:** Extension `.html` → canonical label `html`. Model's `php-template` overridden.

---

## 2026-03-29 — R34: SHOW MORE / STUTTERING FIXES (2 files: FileContentBlock.jsx, appStore.js)

User reported R33 changes had no observable effect: Show More doesn't expand, stuttering persists, empty text blocks remain.

### R34-1: FileContentBlock.jsx — Complete rewrite with inline styles + React.memo

**What changed:**
- Replaced Tailwind arbitrary value classes (`max-h-[240px]`, `max-h-[500px]`) with inline `style={{ maxHeight: ... }}`. Tailwind classes were verified present in compiled CSS, but the approach is fragile — inline styles are deterministic.
- Expanded height changed from `500px` to `80vh` so expanded view fills viewport instead of showing a tiny fraction.
- Wrapped component in `React.memo()`. Previously, FileContentBlock re-rendered 100+/sec because parent Footer re-rendered on every text token. React.memo ensures FileContentBlock only re-renders when its own props change (content changes every 100ms from file token batching).
- Removed `userExpandedRef` (useRef). Replaced with simple `useState(false)` for `expanded`. The `useRef` approach was overengineered — a simple state boolean is sufficient because React.memo prevents unnecessary re-renders that would have caused the old issue.
- Added `console.log('[FileContentBlock] handleExpand fired')` and `handleCollapse` logging for debugging.
- Added `zIndex: 2` on the "Show more" overlay to prevent potential z-ordering issues.
- **Before:** Clicking "Show more" had no visual effect. Code block stuttered during streaming.
- **After:** Inline styles guarantee height changes. React.memo prevents parent re-render cascades.

### R34-2: appStore.js `appendStreamToken` — Text token batching (80ms)

**What changed:**
- `appendStreamToken` now uses the same batching pattern as `appendFileContentToken`: tokens accumulate in `_textTokenBuffer`, flushed to state via `setTimeout` every 80ms.
- Previously, `appendStreamToken` called `set()` on EVERY token (~100/sec). Each call created a new `streamingSegments` array, causing the entire Footer (and all children) to re-render 100+/sec.
- Now: ~12 `set()` calls/sec instead of ~100. Combined with React.memo on FileContentBlock, the code block only re-renders when its content actually changes (~10/sec from file token batching).
- **Before:** 100+ re-renders/sec on Footer and all children including FileContentBlock.
- **After:** ~12 re-renders/sec on Footer, ~10/sec on FileContentBlock (only when props change).

### R34-3: appStore.js — Flush text buffer at transition points

**What changed:**
- `setChatStreaming(false)` — now clears `_textTokenTimer` and flushes `_textTokenBuffer` before clearing streaming state. Prevents message content loss.
- `startFileContentBlock` — now flushes `_textTokenBuffer` before adding file segment. Ensures text segment is up-to-date before the file segment is inserted (correct chronological ordering).
- `clearFileContentBlocks` — now also clears `_textTokenTimer` and `_textTokenBuffer`.
- `clearChat` — now also clears both timers and buffers.
- **Before:** Text buffer might have pending tokens when streaming ends, losing the last ~80ms of text. File segment could be inserted before buffered text was flushed, breaking chronological order.
- **After:** All transition points flush pending text tokens first.

---

## 2026-03-29 — R33: 8 UI/TOOL DEFECTS FROM R32 TEST (5 files: server/main.js, appStore.js, FileContentBlock.jsx, ChatPanel.jsx + 1 new: webSearch.js)

User reported 8 issues during R32 test (963-line solar-system.html, 4 context shifts — test PASSED functionally). The issues are UI polish and missing features.

### Phase 1 — File Explorer auto-update (server/main.js)
**Change:** After `new MCPToolServer()` at ~L128, added `mcpToolServer.setBrowserManager({ parentWindow: mainWindow })`.
- **Root cause:** mcpToolServer has 9 references to `browserManager.parentWindow.webContents.send()` for `files-changed` and `agent-file-modified` events. In web-server mode, `browserManager` was never set (null), so these events silently failed.
- **Before:** File Explorer never updated after tool creates/modifies files.
- **After:** mcpToolServer routes file events through the MainWindowBridge → WebSocket → frontend, triggering tree refresh.

### Phase 2 — Code block stabilization (FileContentBlock.jsx + appStore.js)

**Change 2A: FileContentBlock.jsx** — Complete rewrite of line counting and expand/collapse.
- Removed MutationObserver + 500ms interval line counting approach entirely.
- Line count now computed from `content` prop via `useMemo(() => content.split('\n').length)`.
- Removed `likelyLong` heuristic (content.length > 500) — was causing premature collapse.
- User expand state is now sticky via `useRef(false)` for `userExpandedRef`. When user clicks "Show More", `userExpandedRef.current = true`. This survives re-renders during streaming. `isCollapsed` returns false whenever `userExpandedRef.current` is true.
- **Root cause of stuttering:** MutationObserver fired on every DOM change, lineCountRef updated, but React state `lineCount` only synced every 500ms. Between syncs, `lineCount === 0` → "(0 lines)" flash.
- **Root cause of Show More broken:** `setCollapsed(false)` was overridden on next re-render because `isCollapsed` recalculated with `lineCount === 0` → collapsed again.
- **Before:** Code block flickered "0 lines" during streaming. "Show More" snapped back to collapsed immediately.
- **After:** Line count stable (computed from prop). Expand state sticky until user manually collapses.

**Change 2B: appStore.js `appendFileContentToken`** — Batched token accumulation.
- Instead of calling `set()` on every token (100+/sec), tokens accumulate in `_fileTokenBuffer` and flush to state every 100ms via `setTimeout`.
- `endFileContentBlock` flushes any pending buffer before marking complete.
- `clearFileContentBlocks` clears any pending timer.
- **Before:** ~100 Zustand `set()` calls/sec → 100 React re-renders/sec → stuttering.
- **After:** ~10 Zustand `set()` calls/sec → smooth streaming.

### Phase 3 — Empty text box fix (ChatPanel.jsx)

**Change 3A:** Footer streaming text guard: `chatStreamingText && chatStreamingText.trim()` instead of just `chatStreamingText`.
- **Before:** Whitespace-only text (e.g. trailing newlines from "Writing **filename**...\n") rendered an empty text area.
- **After:** Empty/whitespace text suppressed.

**Change 3B:** Finalization guard: `messageContent && messageContent.trim()` before adding assistant message.
- **Before:** Could create empty assistant message bubble.
- **After:** Empty messages suppressed.

**Change 3C:** Bounce dots threshold: `!chatStreamingText && !chatThinkingText && streamingSegments.length === 0`.
- **Before:** Bounce dots showed even when file blocks were actively streaming (no text but file content visible).
- **After:** Bounce dots only show when nothing is streaming at all.

### Phase 4 — Chronological ordering (appStore.js + ChatPanel.jsx)

**Change 4A: appStore.js** — Added `streamingSegments: []` state field.
- Each segment is `{type: 'text', content}` or `{type: 'file', index}` where `index` points into `streamingFileBlocks`.
- `appendStreamToken` appends to last text segment or creates new one, preserving insertion order relative to file blocks.
- `startFileContentBlock` pushes a file segment after any accumulated text.
- `setChatStreaming(false)`, `clearFileContentBlocks`, and `clearChat` all clear segments.
- **Root cause:** Previous architecture had `chatStreamingText` (single accumulated string) and `streamingFileBlocks[]` (array). Footer rendered ALL text THEN ALL files. No way to interleave text before/between/after file blocks.

**Change 4B: ChatPanel.jsx Footer** — Renders `streamingSegments.map()` instead of separate text + files.
- Text segments render as MarkdownRenderer. File segments render as FileContentBlock.
- Streaming cursor shown after last text segment only.
- **Before:** "Writing **filename**..." text above code block, then model's post-file text also above code block.
- **After:** Content appears in chronological order: text → file block → text → file block.

**Change 4C: ChatPanel.jsx finalization** — Composites from `streamingSegments` in order.
- Iterates segments: text segments become markdown, file segments become fenced code blocks.
- Fallback to old `chatStreamingText + streamingFileBlocks` if segments empty (defensive).
- **Before:** Final message was always text-first, files-last.
- **After:** Final message preserves chronological ordering.

### Phase 5 — Web search (webSearch.js + server/main.js)

**Change 5A:** Created `webSearch.js` — DuckDuckGo HTML scraping, no API key.
- `search(query, maxResults)` → fetches `html.duckduckgo.com/html/?q=...`, parses result blocks for title/url/snippet.
- `fetchPage(url)` → fetches URL, strips scripts/styles/tags, returns readable text. Capped at 15KB + 2MB response limit.
- HTTP(S) with redirect following, timeout (10s), response size limit (2MB).
- URL validation: only http/https protocols accepted.

**Change 5B: server/main.js** — Wired WebSearch into MCPToolServer.
- `const WebSearch = require('./webSearch'); const webSearch = new WebSearch();`
- Passed `webSearch` to `MCPToolServer` constructor.
- Updated ctx object from `webSearch: null` to `webSearch`.
- **Before:** `mcpToolServer._webSearch()` returned `{success: false, error: 'Web search not available'}`.
- **After:** Web search and page fetch are functional.

---

## 2026-03-29 — R32 FIX: 5 DEFECTS FROM R31 TEST 2 (2 files: agenticLoop.js, nativeContextStrategy.js)

Root cause of 5 defects: rotationCheckpoint corruption cascade. In R31 test 2, iter 2's rotation protection blocked a write_file and nulled rotationCheckpoint. Iter 3's append_to_file succeeded on disk but couldn't update the checkpoint (null). Iter 4's write_file was blocked by MCP overwrite protection (returns { success: false } without throwing), but the checkpoint update code ran anyway because it's in the try block — setting checkpoint to 1871 chars of blocked content instead of the 22509 chars actually on disk. All subsequent T42 summaries showed wrong line count (101 vs 1011), causing model disorientation: paradigm shift (HTML→React), stuck loops (3x identical CHARTS), and structurally incomplete file (no `</html>`).

### R32 Phase A — Fix rotationCheckpoint corruption (agenticLoop.js, 3 changes)

**Change A1:** Rotation protection "skip" branch (~L1382) — removed `rotationCheckpoint = null`.
- **Before:** When a write_file was blocked (content shorter than checkpoint), the checkpoint was nulled.
- **After:** Checkpoint preserved. Blocking a write does not change what's on disk. Subsequent append_to_file calls can accumulate content correctly.

**Change A2:** After rotation protection if/else block (~L1391) — removed `rotationCheckpoint = null`.
- **Before:** After both "continuation" (write→append conversion) and "allow write" branches, checkpoint was nulled.
- **After:** Checkpoint preserved. For continuation: the append checkpoint accumulation at ~L1540 correctly accumulates onto existing content. For allow: the checkpoint update at ~L1525 correctly updates when write succeeds.

**Change A3:** R16-Fix-B checkpoint update (~L1522) — added `toolSucceeded` guard.
- **Before:** Checkpoint updated unconditionally for write_file/create_file when `effectiveArgs?.content` was truthy. MCP overwrite protection returns `{ success: false }` WITHOUT throwing, so the try block continued and the checkpoint was set to the blocked content.
- **After:** `const toolSucceeded = toolResult?.success !== false && !toolResult?.error;` checked before all checkpoint update branches. Failed writes log but do NOT modify checkpoint. Also added logging for failed tool write operations.
- **Observable:** Log should show `R32-Fix Phase A: Tool write_file failed — checkpoint NOT updated` when MCP blocks a write. Checkpoint should maintain accurate content across iterations.

### R32 Phase B — Pre-execution duplicate write blocking (agenticLoop.js, 1 change)

**Change B1:** Added pre-execution duplicate check for write tools (~L1349, before rotation protection).
- **What:** For write_file, create_file, append_to_file: compute paramsHash (first 400 chars of JSON.stringify), check against last 2 entries in recentToolSigs. If match found, skip execution and inject synthetic "Blocked: duplicate" result.
- **Why:** Existing stuck/cycle detection at ~L1595 runs AFTER executeTool — duplicate writes hit disk BEFORE detection. Phase B catches them BEFORE execution.
- **Also:** Blocked calls immediately push to recentToolSigs so duplicate calls within the SAME iteration batch are also caught.
- **Observable:** Log should show `R32-Fix Phase B: Blocked duplicate append_to_file — identical to recent call` when model repeats same write content.

### R32 Phase C — Structural context preservation (agenticLoop.js + nativeContextStrategy.js, 3 changes)

**Change C1:** T42 file summary HEAD inclusion (nativeContextStrategy.js ~L188).
- **Before:** T42 summary only preserved tail content (last N chars). Model lost awareness of file opening structure (DOCTYPE, `<html>`, `<head>`).
- **After:** First 5 lines of file content (up to 200 chars, `headBudget`) included in T42 summary: `File starts with:\n${headText}\n...\nLast content written:\n${tail}`. Tail budget reduced by head size + 30 chars padding.
- **Observable:** After context shift, model should see both the beginning and end of its file in the condensed summary. Prevents paradigm shifts (HTML→React) caused by losing structural awareness.

**Change C2:** Structural completeness hints in R16-Fix-B non-salvage path (agenticLoop.js ~L1807).
- **Before:** nextUserMessage asked model to "review whether ALL content is in the file" without specifying what "complete" means for the file type.
- **After:** Detects file extension and adds type-specific hint: HTML must end with `</body></html>`, SVG with `</svg>`, XML with closing root tag, JSON with balanced brackets. Also includes first 5 lines (HEAD) of file alongside last 30 lines (tail) so model sees full structural bookends.
- **Observable:** Model should produce structurally complete files (with closing tags) instead of stopping mid-content.

**Change C3:** R14-Fix-2 contentStreamed guard (agenticLoop.js ~L1574).
- **Before:** `contentStreamed = true` set unconditionally for all write_file/create_file entries with content, regardless of whether the tool succeeded.
- **After:** Only set when `entry.result?.success !== false && !entry.result?.error`. Blocked/failed writes do NOT suppress CodeBlock rendering.
- **Observable:** UI line count should match disk line count. When MCP blocks a write, the content block is still rendered so the user can see what was attempted.

---

## 2026-03-29 — R31 FIX: Fix-M PROSE INJECTION BUG (1 file: agenticLoop.js)

Root cause: In R30 test (iter 4, completeness check), the model replied with prose "I have successfully created the interactive world atlas web app..." (926 chars, no tool call). Fix-M (T34) fired because:
1. `rotationCheckpoint` was still set (T58-Fix-A set it in iter 3 but did not clear it)
2. `looksLikeProse` regex did not match "I have successfully..." — only checked "I've", "Here's", "The file", etc.
3. `codeChars >= 5` was true (prose contained `.`, `(`, `)` chars from "world-atlas.html (421 lines)")

Result: Fix-M called `append_to_file` with the 926-char prose, which Smart HTML insert injected before `</html>` at line 1301. File was corrupted.

Second defect: Model restarted file via append_to_file (`<!DOCTYPE html>` at L1046). R16-Fix-B reported "191 lines" (only iter 2's append) instead of "882 lines" (full file). Model thought HTML structure was missing.

Third defect: JS appended after `</script>` without `<script>` wrapper. T42 tail showed only iter 2's JS, didn't include `</script>` boundary from iter 1.

### R31 Change 1: T58-Fix-A complete path — null rotationCheckpoint (agenticLoop.js ~L1659)
- **What changed:** After `stream.endFileContent()` in the T58-Fix-A "content COMPLETE" branch, added `rotationCheckpoint = null;`
- **Why:** When T58-Fix-A confirms the file is structurally complete and closes it, there is no reason to keep rotationCheckpoint. Clearing it prevents Fix-M from conditional-triggering on the model's summary response in the next iteration.
- **Observable:** Fix-M should NOT fire when model outputs summary prose after T58 closes the file. Log should NOT show "Fix-M (T34): Appended X chars" after file completion.

### R31 Change 2: looksLikeProse regex expansion — REVERTED
- **What changed:** Was expanded to match more phrases. User rejected as test-specific and fragile. Reverted to original.

### R31 Change 3: Phase 1 — fileCompletionCheckPending flag (agenticLoop.js)
- **Declared** `let fileCompletionCheckPending = false;` and `let fileRestartRetries = 0;` at ~L204
- **Set true** in T58-Fix-A complete path (~L1663) after `stream.endFileContent()`
- **Set true** in R16-Fix-B (R23) non-salvage path (~L1703) after setting nextUserMessage
- **Guard added** in R16-Fix-C else block (~L1879) BEFORE Fix-M:
  - If `fileCompletionCheckPending && toolCalls.length === 0`: null `rotationCheckpoint` and clear flag. Fix-M's existing `if (rotationCheckpoint && ...)` naturally fails.
  - If `fileCompletionCheckPending && toolCalls.length > 0`: model is continuing, clear flag and proceed normally.
- **Why:** State-based solution. No text-matching heuristics needed for Fix-M entry condition. When file completion is detected (T58-Fix-A or R16-Fix-B) and the model's next response has no tool calls (= summary prose), the checkpoint is nulled so Fix-M cannot inject prose.

### R31 Change 4: Phase 2 — Accurate line count and tail from rotationCheckpoint (agenticLoop.js)
- **T32-Fix incomplete branch** (~L1635): Moved checkpoint update BEFORE line count calculation. Uses `rotationCheckpoint.content` for `lineCount` and `tailLines` instead of just `writtenContent` (current iter's write).
- **T58-Fix-A complete branch** (~L1655): Same — uses `rotationCheckpoint.content` for `lineCount`.
- **R16-Fix-B (R23) non-salvage branch** (~L1678): Replaced `fileSummary` construction and `tailLines` extraction to prefer `rotationCheckpoint.content` when its `filePath` matches. Falls back to `toolResultEntries` when no checkpoint.
- **Why:** R16-Fix-B was reporting only the current iteration's append lines (191), not the full accumulated file (882). The model saw "191 lines" and concluded it needed to write the missing HTML structure. Using rotationCheckpoint gives the full picture across all iterations.

### R31 Change 5: Phase 3 — Head-of-file restart detection (agenticLoop.js ~L1435)
- **Where:** After T58-Fix-B overlap detection, before `executeTool` call
- **What:** When `append_to_file` is called on a file with an existing `rotationCheckpoint`, compare first 3 non-empty trimmed lines of append content vs first 3 non-empty trimmed lines of checkpoint content. If all 3 match → the model is restarting the file from the beginning.
- **Action on detection:** Reject the tool call (do not execute). Set `nextUserMessage` to re-prompt with tail of existing file, telling model to continue after that point. Max 2 retries via `fileRestartRetries` counter. After 2 retries, allow append to proceed.
- **Why:** Even with accurate line counts (Phase 2), a model post-rotation may still attempt to restart. This is a guard that catches the symptom and re-prompts correctly.

### R30 Test Results
- File: ~1309 lines, 3 context shifts, 3 iterations producing file content
- Iter 1: write_file 691 lines. Iter 2: append_to_file +190 lines. Iter 3 (T58-Fix-A salvage): append_to_file +421 lines. File complete (ends in </body></html>)
- Iter 4: completeness summary prose → Fix-M injected prose into HTML (R31 defect, now fixed)
- R30 fixes working: embedded JSON detection fired at iters 2 and 3, T42 file summaries preserved, line count monotonically increased
- **Defects from R30 test:** Fix-M prose injection, file restart via append, JS outside script — all addressed by R31 Phases 1-3

---

## 2026-03-29 — R30 INTER-ITERATION CONTEXT SHIFT FIX (1 file: nativeContextStrategy.js)

Root cause: After context shift + salvage path at iter 1 end, T32-Fix injects a continuation message (user type) asking the model to use append_to_file. At iter 2 start, chatHistory = [system, user, model(24K), continuation_user(700)]. The 35K chatHistory exceeds 8K context, triggering another context shift via nativeContextShiftStrategy. Two bugs in the strategy caused the model to lose all file-writing awareness:

1. `detectActiveFileGeneration()` only checked the LAST chatHistory item. At iter 2, last item = T32-Fix continuation (user type). Function returned null. The entire file-aware budget allocation (T21/T27-Fix) and T42-Fix content summary were skipped.

2. `truncateModelItem()` R13-Fix-D1 used `startsWith('{"tool"')` to detect tool call JSON. The model's response was a single string segment starting with prose ("I'll create a complete interactive periodic table...") followed by the JSON tool call. `startsWith` failed because the segment starts with prose, not `{"tool"`. T42-Fix file content summary was never generated.

Result: model at iter 2 saw truncated tail of its own response (raw JS ending with triple backticks = closing markdown fence) instead of a file content summary. Model interpreted backticks as "I just closed a code block" and output prose + new fence instead of append_to_file tool call. 102 chars, loop exited, file stayed incomplete at 432 lines.

Cross-checked against REVERTED_FIXES.md — none of the 17 reverted fixes involve nativeContextStrategy.js or these detection functions. No conflict.

### R30 Change 1: detectActiveFileGeneration() — scan backwards (nativeContextStrategy.js ~L288-320)
- **What changed:** Function now iterates backwards through chatHistory to find the most recent `model` type entry, instead of only checking `chatHistory[chatHistory.length - 1]`. Also detects T42-Fix condensed summary format (`[I was writing "file" with write_file`).
- **Why:** When chatHistory ends with a user continuation message (the normal case after T32-Fix), the old code returned null. The file-aware budget allocation and T42-Fix summary path were completely skipped.
- **Observable:** `[NativeCtxShift] Active file generation: periodic-table.html` should appear in logs even when last item is a user continuation message. T21/T27-Fix budget allocation should fire.

### R30 Change 2: truncateModelItem() — embedded JSON detection (nativeContextStrategy.js ~L107-150)
- **What changed:** After existing `startsWith` checks, added fallback regex search for `{"tool":"write_file|..."` anywhere in string segments. When found mid-segment, splits at the JSON start: prose prefix added to prefixSegs, JSON portion passed to T42-Fix for file content extraction.
- **Why:** The model commonly outputs prose intro text + JSON tool call in the same string segment. `startsWith` only found JSON at the very start. When prose preceded JSON (which is every time), T42-Fix never fired, and the model's 24K response was tail-truncated to raw JavaScript + backticks.
- **Observable:** `[NativeCtxShift] R30-Fix: Found embedded tool call JSON at char X` and `[NativeCtxShift] T42-Fix/R28-2: Preserved file content summary for "..."` should appear in logs during inter-iteration context shifts.

### R29 Test Results (completed before R30, for reference)
- File on disk: 432 lines, 23812 bytes at `test-project/r29-test/periodic-table.html`
- File structurally incomplete: no `</script>`, `</body>`, `</html>` tags
- One context shift survived mid-generation (98%→71%, lines continued growing)
- Language label correctly showed "HTML" during streaming (R29 fix working)
- T32-Fix correctly detected incomplete file and injected continuation
- Iter 2 failed: model output 102 chars of prose instead of append_to_file tool call
- Root cause traced to two bugs in nativeContextStrategy.js (see above)

### Files Modified:
- `pipeline/nativeContextStrategy.js` — R30 (2 function changes)

## 2026-03-29 — R29 SYSTEMATIC ESCAPED-QUOTE REGEX FIX (1 new file, 5 patched files)

Root cause: Qwen3.5-2B (and potentially other small models) outputs tool call JSON with escaped quotes in keys: `\"filePath\":\"file.html\"` instead of `"filePath":"file.html"`. R28-1b patched 1 out of 38 regex locations. The remaining 37 were vulnerable, causing T44-Fix to retain only 20 chars (budget was 9630), content streaming to use wrong language label (PHP-TEMPLATE), and file extraction to fail at multiple pipeline stages.

Cross-checked against REVERTED_FIXES.md — none of the 17 reverted fixes involved escaped-quote regex. No conflict.

### R29: Created pipeline/regexHelpers.js (new file)
- **Three helper functions** that try standard regex first, then escaped-quote variant:
  - `matchFilePathInText(text)` — matches `"filePath":"..."` OR `\"filePath\":\"...\"`
  - `matchContentStartInText(text)` — matches `"content":"` OR `\"content\":\"` (position only)
  - `matchContentValueInText(text)` — matches `"content":"(value)` OR `\"content\":\"(value)` (with capture)
- Standard patterns tried first for backward compatibility; escaped patterns act as fallback

### R29: Patched pipeline/nativeContextStrategy.js (2 regex sites)
- L127: `fpMatch` — replaced inline filePath regex with `matchFilePathInText(jsonSeg)`
- L128: `contentMatch` — replaced inline content regex with `matchContentValueInText(jsonSeg)`
- **Observable:** T42-Fix/R28-2 budget math at L144 now EXECUTES when model uses escaped quotes. T44-Fix log should show `tail=~8000` instead of 20 chars. Context summary should contain file path and line count.

### R29: Patched pipeline/streamHandler.js (3 regex sites)
- L261: `fpMatch` in `_streamFileContent` — replaced `FILE_PATH_RE` with `matchFilePathInText(json)`
- L281: `contentMatch` for content-type sniffing — replaced inline regex with `matchContentStartInText(json)`
- L510: `fpMatch` in `continueToolHold` — replaced `FILE_PATH_RE` with `matchFilePathInText(this._toolCallJson)`
- **Observable:** `file-content-start` event should show actual filePath (not "unknown"), language should be "html" (not "text"), no PHP-TEMPLATE label.

### R29: Patched pipeline/agenticLoop.js (15 regex sites)
- Added `require('./regexHelpers')` import
- Replaced all 13 `FILE_PATH_RE` usage sites with `matchFilePathInText()`:
  - L363 (CONTEXT_OVERFLOW), L503 (non-file-tool save), L543 (non-file-tool continuation),
  - L561/L563 (D6 new-tool-call detection), L780 (continuation checkpoint),
  - L854 (eogToken checkpoint), L896 (braceDepth<=0 save), L934 (failed-tool-call save),
  - L1021 (salvage path), L1192 (initial partial checkpoint), L1237 (timeout checkpoint)
- Replaced 3 content-start regex sites with `matchContentStartInText()`:
  - L373 (CONTEXT_OVERFLOW StreamHandler extraction), L1030 (T31-Fix salvage),
  - L1115 (R28-1b StreamHandler extraction)
- **Observable:** All checkpoint/salvage paths now succeed on escaped-quote model output. No more "R28-1b" fallback entries in logs (main salvage path handles it).

### R29: Patched pipeline/continuationHandler.js (1 regex site)
- L52: `contentMatch` — replaced inline content regex with `matchContentValueInText(taskContext.accumulatedBuffer)`
- **Observable:** Continuation messages correctly count lines and extract tail even with escaped-quote JSON.

### R29: Patched pipeline/responseParser.js (3 changes)
- Added escaped-quote variants to `extractContentFromPartialToolCall` patterns array:
  - `\\?"content\\?"\\s*:\\s*\\?"(content...)` after standard pattern
  - `\\?"fileContent\\?"\\s*:\\s*\\?"(content...)` after standard fileContent pattern
- Changed inner tool-wrapper guard test to handle escaped quotes: `\\?"tool\\?"\\s*:\\s*\\?"`
- Changed inner content extraction to use `matchContentValueInText(content)`
- **Observable:** `extractContentFromPartialToolCall` now succeeds on escaped-quote tool calls, returning content instead of null.

### R28 Test Results (completed before R29, for reference)
- File on disk: 214 lines, 15333 bytes at `test-project/r28-test/periodic-table.html`
- 7 defects found — all traced to escaped-quote regex failures at unpatched locations
- T44-Fix measured 20 chars (budget 9630) because nativeContextStrategy fpMatch/contentMatch returned null
- Defects: T44 20-char truncation, literal `\n` in file, markdown fence in file, leading `/`, PHP-TEMPLATE label, naked code in chat, empty TEXT block

### Files Modified:
- `pipeline/regexHelpers.js` — NEW FILE (R29 helper functions)
- `pipeline/nativeContextStrategy.js` — R29 (2 regex sites)
- `pipeline/streamHandler.js` — R29 (3 regex sites)
- `pipeline/agenticLoop.js` — R29 (15 regex sites + import)
- `pipeline/continuationHandler.js` — R29 (1 regex site + import)
- `pipeline/responseParser.js` — R29 (3 changes + import)

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

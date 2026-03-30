# guIDE 2.0 vs IDE v1 — Feature Comparison

> Last updated: 2026-03-30
> Tracks what exists in guide-2.0 vs what existed in IDE v1.
> Items marked [x] have been verified to exist in the codebase.

---

## Legend

- [x] = Present and functional in guide-2.0
- [~] = Partially present (stub, incomplete, or not fully wired up)
- [ ] = MISSING from guide-2.0 (existed in v1)

---

## Backend / Server-Side Features

### Core AI Pipeline
- [x] agenticChat.js — main chat orchestration
- [x] agenticChatHelpers.js — helper functions
- [x] llmEngine.js — local LLM inference (node-llama-cpp)
- [x] cloudLLMService.js — cloud AI provider integration
- [x] modelDetection.js — model file detection
- [x] modelManager.js — model loading/unloading
- [x] modelProfiles.js — model-specific configurations
- [x] longTermMemory.js — persistent memory
- [x] memoryStore.js — memory storage backend
- [x] sessionStore.js — conversation session persistence
- [x] mcpToolServer.js — MCP tool execution
- [x] sanitize.js — input sanitization
- [x] pathValidator.js — path security validation
- [x] logger.js — logging
- [x] constants.js — shared constants
- [x] webSearch.js — DuckDuckGo HTML search + page fetch (R33-Phase5)

### Pipeline (guide-2.0 has dedicated pipeline/ directory)
- [x] agenticLoop.js
- [x] contextManager.js
- [x] continuationHandler.js
- [x] conversationSummarizer.js
- [x] nativeContextStrategy.js (Solution A — v2 only, replaces old contextManager compaction)
- [x] promptAssembler.js
- [x] responseParser.js
- [x] rollingSummary.js
- [x] streamHandler.js

### Tool Modules (tools/ directory)
- [x] toolParser.js — tool call parsing
- [x] mcpGitTools.js — Git tool methods (status, commit, diff, log, branch, checkout, push, pull)
- [x] mcpBrowserTools.js — Browser automation methods (navigate, click, screenshot, evaluate)

### Server Infrastructure
- [x] server/main.js — Express + WebSocket server
- [x] server/transport.js — WebSocket transport layer
- [x] server/ipcBridge.js — IPC bridge for Electron
- [x] server/liveServer.js — live preview server
- [x] server/modelDownloader.js — model download from HuggingFace
- [x] server/templateHandlers.js — project template handling
- [x] server/_electronShim.js — Electron API shim for web mode

### Electron / Desktop
- [x] electron-main.js — Electron main process (single instance, GPU flags, BrowserWindow)
- [x] preload.js — Electron preload script
- [x] scripts/build-installers.js — installer build script

### Missing Backend Files
- [ ] **benchmarkScorer.js** — model benchmark/scoring system
- [ ] **debugService.js** — debug/profiling service backend
- [ ] **imageGenerationService.js** — cloud AI image generation
- [ ] **localImageEngine.js** — local image generation via Stable Diffusion
- [ ] **playwrightBrowser.js** — Playwright browser automation controller (browser tools exist but no standalone manager)

### Implemented This Session (2026-03-30)
- [x] **settingsManager.js** — persistent user settings + encrypted API key storage
- [x] **appMenu.js** — Electron native menu bar (File/Edit/View/Help menus)
- [x] **gitManager.js** — standalone Git manager class with execFileSync (no shell injection)
- [x] **browserManager.js** — integrated browser panel management (live server + optional Playwright)
- [x] **firstRunSetup.js** — first-run onboarding wizard (system detection + recommended settings)
- [x] **autoUpdater.js** — automatic update checking/downloading/installing via electron-updater
- [x] **ragEngine.js** — BM25 codebase search (offline, no embedding models)
- [x] **accountManager.js** — account/auth system (email/password + OAuth + session persistence)
- [x] **licenseManager.js** — license validation + Stripe checkout integration

---

## Frontend Components

### Core Layout & Chrome — ALL PRESENT
- [x] Layout.jsx — VS Code-like grid layout with resizable splitters
- [x] ActivityBar.jsx — left vertical icon strip (explorer, search, git, debug, extensions, settings, account)
- [x] Sidebar.jsx — switchable panels (FileExplorer, SearchPanel, GitPanel, SettingsPanel, DebugPanel, ExtensionsPanel)
- [x] EditorArea.jsx — Monaco Editor + tab bar + diff viewer + preview
- [x] EditorPreviews.jsx — file preview renderers
- [x] BottomPanel.jsx — terminal + output panels (xterm.js)
- [x] StatusBar.jsx — branch, errors/warnings, context ring, model, language, line/col, encoding, EOL
- [x] TitleBar.jsx — window controls + guIDE branding + native menu simulation
- [x] CommandPalette.jsx — Ctrl+Shift+P, fuzzy search, 27+ commands

### Chat System — ALL PRESENT
- [x] ChatPanel.jsx — main chat interface with streaming, tool calls, checkpoints
- [x] chat/CodeBlock.jsx — syntax-highlighted code blocks with copy/save/apply/line numbers
- [x] chat/FileContentBlock.jsx — streaming file content display (collapsed/expanded)
- [x] chat/MarkdownRenderer.jsx — markdown with rehype-highlight
- [x] chat/MermaidBlock.jsx — Mermaid diagram rendering
- [x] chat/ToolCallCard.jsx — tool call display with collapsible params/result

### Standalone Components — ALL PRESENT
- [x] ThemeProvider.jsx — 10 themes (Monolith default), CSS variable system, localStorage persistence
- [x] DiffViewer.jsx — side-by-side diff viewer using Monaco DiffEditor
- [x] InlineChat.jsx — Ctrl+I inline chat widget
- [x] FileIcon.jsx — type-specific file icons by extension
- [x] ErrorBoundary.jsx — error boundary wrapping entire app
- [x] Notifications.jsx — toast notifications (auto-dismiss, typed, action buttons)
- [x] WelcomeGuide.jsx + WelcomeScreen.jsx — onboarding + getting started
- [x] NewProjectDialog.jsx — project creation modal
- [x] ModelDownloadPanel.jsx — model download from HuggingFace
- [x] AccountPanel.jsx — account settings

### Sidebar Panels (inside Sidebar.jsx)
- [x] **FileExplorer** — file tree with recursive rendering, icons, expand/collapse, context menu (new/rename/delete/copy), git status badges (M/A/?)
- [x] **SearchPanel** — workspace-wide search, debounced, results grouped by file
- [x] **GitPanel** — branch display, staged/modified/untracked files, recent commits
- [x] **SettingsPanel** — theme selector, inference controls (temperature/top_p/top_k/max_response_tokens/max_iterations/gpu_layers), tool toggles (10 tools), MCP server config, keyboard shortcuts (15)
- [~] **DebugPanel** — stub (UI shell exists, no real debugger backend)
- [~] **ExtensionsPanel** — stub (UI shell exists, no extension system)

### Stores
- [x] stores/appStore.js — Zustand global state (theme, files, tabs, chat, model, settings)
- [x] api/websocket.js — WebSocket client for server communication

### Missing Frontend Components
- [ ] **BenchmarkPanel** — model benchmarking UI
- [ ] **CodeReviewPanel** — code review interface
- [ ] **CollabPanel** — collaboration features
- [ ] **DatabasePanel** — database management
- [ ] **DocsPanel** — documentation viewer
- [ ] **NotebookPanel** — Jupyter notebook support
- [ ] **PluginPanel** — extension/plugin management
- [ ] **ProfilerPanel** — performance profiling
- [ ] **RestClientPanel** — API testing (like Postman)
- [ ] **SSHPanel** — SSH remote connections
- [ ] **SmartSearchPanel** — AI-powered semantic search
- [ ] **TaskCreator / TaskQueuePanel** — task management
- [ ] **VoiceCommandButton** — voice input

### Implemented This Session (2026-03-30)
- [x] **BrowserPanel** — integrated browser preview with iframe, URL bar, start/stop, hot-reload

---

## Website / Account System

### Website Pages (at graysoft.dev — served from IDE/website/)
- [x] Download page (exists, needs v2.0.0 update)
- [x] Home/landing page
- [x] About page
- [x] Blog
- [x] Contact
- [x] FAQ
- [x] Privacy / Terms
- [x] Model catalog (models page)
- [x] Competitor comparison pages (vs/ Cursor, Copilot, Tabnine, Windsurf)

### Account/Auth System (website API routes)
- [x] **User login** — `POST /api/account/login` (accountManager.js)
- [x] **OAuth start** — `POST /api/account/oauth/start` (Google/GitHub)
- [x] **OAuth callback** — `POST /api/account/oauth/callback`
- [x] **Session refresh** — `POST /api/account/refresh`
- [x] **Account status** — `GET /api/account/status`
- [x] **Logout** — `POST /api/account/logout`
- [ ] **User registration** — `/api/auth/register` (server-side, not in desktop app)
- [ ] **Token activation** — `/api/auth/activate-token` (server-side)

### Subscription / Payments
- [x] **Stripe checkout** — `POST /api/stripe/checkout` (licenseManager.js)
- [x] **Subscription check** — `GET /api/stripe/subscription` (licenseManager.js)
- [ ] **Stripe webhook** — `/api/stripe/webhook` (server-side, not in desktop app)
- [ ] **Donation tracking** — `/api/donate`, `/api/donate/total` (server-side)

### License System
- [x] **License activation** — `POST /api/license/activate` (licenseManager.js, key format + server verify)
- [x] **License status** — `GET /api/license/status` (with plan info)
- [x] **License plans** — `GET /api/license/plans` (free/pro/team)
- [x] **License deactivation** — `POST /api/license/deactivate`
- [x] **LicenseManager** in desktop app — machine-bound, expiry-checked, persisted via settingsManager
- [ ] **License validation** — `/api/license/validate` (server-side)
- [ ] **Machine deactivation** — `/api/license/deactivate-machine` (server-side)

### Cloud AI Integration
- [x] **API key management** — per-provider key storage (settingsManager + encrypted api-keys.enc)
- [ ] **Cloud AI proxy** — `/api/ai/proxy` (routes through graysoft.dev server)
- [ ] **Rate limiting** — per-tier message limits (free vs Pro)
- [ ] **Rate limit -> payment redirect** — when free tier exhausted, redirect to upgrade

### Community / Analytics
- [ ] **Community features** — `/api/community`
- [ ] **Analytics tracking** — `/api/analytics`, `/api/analytics/track`
- [ ] **Contact form** — `/api/contact`

---

## Electron / Desktop Integration

- [x] **Electron main process** — electron-main.js (single instance, GPU flags, BrowserWindow, child process management)
- [x] **Preload script** — preload.js
- [x] **Build scripts** — scripts/build-installers.js
- [x] **Electron native menu** — full File/Edit/Selection/View/Go/Terminal/Help menu bar (appMenu.js) with IPC bridge to renderer
- [x] **Auto-updater** — update checking, downloading, installing via electron-updater (autoUpdater.js)
- [x] **First-run setup** — system detection + recommended settings (firstRunSetup.js)
- [x] **Settings persistence** — settingsManager.js with file-based persistence + encrypted API keys

---

## Tauri Integration (v2-only)

- [x] src-tauri/src/main.rs + lib.rs — Tauri app entry
- [x] src-tauri/tauri.conf.json — Tauri configuration
- [x] src-tauri/Cargo.toml — Rust dependencies
- [x] src-tauri/gen/ — generated schemas + capabilities
- [x] src-tauri/icons/ — app icons for all platforms

---

## Priority Assessment (updated 2026-03-30)

### COMPLETED (was CRITICAL — all done)
1. ~~FileExplorer / FileTree~~ — DONE (Sidebar.jsx FileExplorer)
2. ~~Editor / MonacoEditor~~ — DONE (EditorArea.jsx with @monaco-editor/react)
3. ~~TabBar~~ — DONE (EditorArea.jsx with tabs, close, modified indicator, context menu)
4. ~~TerminalPanel~~ — DONE (BottomPanel.jsx XTermPanel with xterm.js + WebSocket PTY)
5. ~~Download page update~~ — EXISTS (needs v2.0.0 version update)

### COMPLETED (was HIGH — done)
6. ~~SourceControlPanel~~ — DONE (GitPanel in Sidebar.jsx, mcpGitTools.js)
7. ~~GlobalSearch~~ — DONE (SearchPanel in Sidebar.jsx)
8. ~~ModelPicker~~ — DONE (ModelDownloadPanel.jsx with search/filter/favorites)
9. ~~Settings~~ — DONE (SettingsPanel in Sidebar.jsx with inference controls + tool toggles + MCP config)

### HIGH (remaining — expected features)
All HIGH priority items have been implemented.

### MEDIUM (value-add — remaining)
6. BrowserPanel — DONE
7. gitManager.js — DONE
8. ragEngine.js — DONE
9. Stripe / Subscription — DONE (client-side checkout + subscription check; webhook is server-side)
10. License system — DONE

### LOW (nice-to-have)
11. BenchmarkPanel — model scoring
12. NotebookPanel — Jupyter
13. RestClientPanel — API testing
14. VoiceCommandButton — voice input
15. CollabPanel — collaboration
16. SSHPanel — remote connections
17. imageGenerationService.js / localImageEngine.js — image generation
18. debugService.js — real debugger backend (UI stub exists)
19. playwrightBrowser.js — standalone Playwright controller (browserManager handles basic cases)

# guIDE 2.0 — UI Rebuild Checklist

> This file tracks every UI feature that needs to be built.
> When context resets between sessions, read this file to know where to continue.
> Check items off as they are completed. Do not remove items — mark them done.
> Reference the old IDE project at C:\Users\brend\IDE\src for design patterns.

## Design Direction
- Default theme: Monolith (near-black, orange accent, minimal)
- Subtle glassmorphism on panels (backdrop-blur, rgba borders)
- Font: Audio Wide for "guIDE" branding, Inter/system-ui for UI text
- Compact spacing (VS Code density)
- Professional, sleek, modern, futuristic — NOT bloated
- Next-gen VS Code feel — future-proofed

---

## 1. THEME SYSTEM
- [x] ThemeProvider.jsx — React context, 10 themes, CSS custom properties
  - [x] Dark Default
  - [x] Monokai
  - [x] Dracula
  - [x] Nord
  - [x] Solarized Dark
  - [x] GitHub Dark
  - [x] Void
  - [x] Light
  - [x] Catppuccin Mocha
  - [x] Monolith (default)
- [x] CSS variable application on :root
- [x] localStorage persistence (guIDE-theme-v2 key)
- [x] Theme selector UI (in settings or command palette)

## 2. GLOBAL CSS (index.css)
- [x] Theme variable defaults
- [x] Scrollbar styling (thin, themed)
- [x] Glassmorphism utility classes
- [x] Audio Wide font import (@fontsource or Google Fonts)
- [x] Base dark background
- [x] Selection colors
- [x] Focus styles
- [x] Animations (fade, slide, spin, scale-in)

## 3. LAYOUT
- [x] Layout.jsx — VS Code-like grid layout
  - [x] Title bar (with guIDE logo in Audio Wide font)
  - [x] Activity bar (left vertical icon strip)
  - [x] Sidebar (file explorer, search, etc. — switchable panels)
  - [x] Editor area (center — tabs + content)
  - [x] Bottom panel (terminal, output, problems — collapsible)
  - [x] Chat panel (right sidebar — resizable)
  - [x] Status bar (bottom)
- [x] All panels use theme CSS variables
- [x] Resizable splitters between panels (with hover indicator + resize overlay)
- [x] Panel collapse/expand (double-click splitter to toggle)

## 4. CHAT INPUT AREA (the cohesive input container)
- [x] Unified rounded border container with theme-aware background
- [x] Todo list dropdown (collapsible, inside container)
- [x] Files changed bar with +/- line counts
  - [x] Keep button (accept all changes)
  - [x] Undo button (revert all changes)
  - [x] Per-file keep/undo
  - [x] Expand/collapse file list
  - [x] Line count diff display (+green/-red)
- [x] Context indicator (current file badge, selected text badge)
- [x] Image attachment previews (thumbnails with remove button)
- [x] File attachment previews
- [x] Message queue display (numbered, editable, removable)
- [x] Textarea with auto-resize (28px default, max 200px)
  - [x] Paste image support
  - [x] Drag-and-drop support
  - [x] Enter to send, Shift+Enter for newline
  - [x] Placeholder text changes when generating vs idle
- [x] Bottom toolbar row:
  - [x] Attach button (paperclip icon)
  - [x] Voice input button (mic icon — can stub for now)
  - [x] Separator
  - [x] Auto mode toggle (pill — Zap icon + "Auto", accent when active)
  - [x] Plan mode toggle (pill — FileCode icon + "Plan", purple when active)
  - [x] Separator
  - [x] Model picker button (shows current model name, truncated, with chevron)
  - [x] Send/Stop button (combined — ArrowUp when idle, Square when generating)

## 5. CHAT MESSAGE RENDERING
- [x] User message bubbles
- [x] Assistant message bubbles
- [x] System message display
- [x] Streaming text with cursor
- [x] Thinking/reasoning display (collapsible)
- [x] Tool call display (inline, with status indicators)
- [x] Model name + icons in message footer
- [x] Checkpoint dividers with restore button
- [x] Virtualized scrolling (react-virtuoso)
- [x] Auto-scroll to bottom during streaming

## 6. CODE BLOCKS (ChatWidgets equivalent)
- [x] Syntax-highlighted code blocks (highlight.js or similar)
- [x] Language label
- [x] Copy button
- [x] Save/download button
- [x] Apply to file button
- [x] Line numbers (optional, toggle button in toolbar)
- [x] Proper fence parsing that doesn't break on inner backticks
- [x] Streaming code block rendering (grows in real-time)

## 7. MARKDOWN RENDERING
- [x] Inline markdown (bold, italic, code, links)
- [x] Block elements (headers, lists, tables)
- [x] Mermaid diagrams
- [x] LaTeX/math rendering (remark-math + rehype-katex)

## 8. MODEL PICKER
- [x] Dropdown panel (appears above input area)
- [x] Local models list with load/unload
- [x] Cloud providers section (Coming soon stubs)
- [x] Model favorites (star toggle, persisted)
- [x] Model status indicators (loaded, loading, error)
- [x] Search/filter
- [x] Model size and family display

## 9. FILE EXPLORER
- [x] FileTree component with recursive rendering
- [x] File/folder icons (by extension — use lucide or file-icon package)
- [x] Expand/collapse folders
- [x] Click to open file in editor
- [x] Context menu (new file, new folder, rename, delete)
- [x] Drag and drop reorder
- [x] File status indicators (modified M, untracked ?, staged A)

## 10. EDITOR AREA
- [x] Monaco Editor integration
- [x] Tab bar with file tabs
  - [x] Close button on tabs
  - [x] Modified indicator (dot)
  - [x] Right-click context menu (Close, Close Others, Close All, Copy Path)
- [x] Multiple open files
- [x] Syntax highlighting (auto-detect language from file extension)
- [x] Minimap (toggleable via settings.minimapEnabled)
- [x] Line numbers
- [ ] Search and replace
- [x] Diff viewer
- [x] Inline chat (Ctrl+I style)

## 11. TERMINAL PANEL
- [x] xterm.js terminal emulator (dynamic import)
- [x] Multiple terminal tabs (create/switch/close)
- [x] Themed to match current theme (reads CSS variables)
- [x] Send commands, show output (via /api/terminal/execute)
- [x] WebSocket PTY backend (node-pty) with exec fallback
- [x] Click to create new terminal (Plus button)

## 12. STATUS BAR
- [x] Theme-aware background
- [x] Left items: branch name (dynamic from git), errors/warnings count (from Monaco diagnostics)
- [x] Right items:
  - [x] Context usage ring/indicator (used/total with percentage)
  - [x] Model name
  - [x] Language mode
  - [x] Line/column position (dynamic from Monaco cursor)
  - [x] Encoding
  - [x] EOL type
- [x] Interactive items (click to change) — EOL, Encoding, Indent, Language

## 13. SETTINGS
- [x] Settings panel (sidebar panel)
- [x] Theme selector with preview
- [x] Model settings (temperature, top_p, top_k, max_response_tokens)
- [x] Max iterations slider (1-25)
- [x] GPU layers preference (-1=auto)
- [x] Tool enable/disable toggles (10 tools with ToggleRight/ToggleLeft icons)
- [x] MCP server configuration
- [x] Keyboard shortcuts display (15 shortcuts with kbd tags)

## 14. COMMAND PALETTE
- [x] Ctrl+Shift+P to open
- [x] Fuzzy search (filters by label, category, or id)
- [x] Theme switching commands (all 10 themes)
- [x] File opening commands (Open Folder, New File)
- [x] Action commands (17 static + 10 theme = 27 total, grouped by category)

## 15. ADDITIONAL FEATURES
- [x] Welcome screen / getting started (2-column layout, shortcuts, actions)
- [x] Toast notifications (auto-dismiss, typed info/warning/error/success, action buttons)
- [x] Error boundary (ErrorBoundary.jsx wrapping entire app)
- [x] Loading states (model loading overlay with progress bar)
- [x] New project dialog (NewProjectDialog component)
- [x] Source control panel (git status with branch, staged/modified/untracked)
- [x] Global search panel (debounced search, results grouped by file)
- [x] Activity bar icons for all panels (debug + extensions stubs added)

## 16. BRANDING
- [x] guIDE logo (custom or text-based with Audio Wide font)
- [x] App icon (zzz.ico — title bar img + favicon + Tauri icon)
- [x] Splash/welcome screen branding

---

## COMPLETION LOG
| Date | Items Completed | Session Notes |
|------|----------------|---------------|
| 2026-04-?? | Sections 1,2,3(partial),4(partial),12(partial),16(partial) | Feature Group 1: Full theme system (10 themes), CSS variable integration, global CSS overhaul, layout theme-awareness, chat input area with unified container + toolbar, context ring in status bar, Audio Wide branding, welcome screen. All hardcoded colors replaced with theme-aware equivalents. |
| 2026-04-?? | Sections 5(partial),6(partial),7(partial),9(most) | Feature Group 2: CodeBlock with syntax highlighting + copy/apply toolbar. MarkdownRenderer with rehype-highlight + custom components. ToolCallCard with collapsible params/result. Streaming cursor. Enhanced FileIcon with type-specific icons. File tree context menu (new/rename/delete/copy path). highlight.js token colors using theme CSS variables. |
| 2026-04-?? | Sections 3(splitters),10(tabs),11(all),13(most),14(all) | Feature Group 3: Editor tab icons + context menu + close confirmation. xterm.js terminal with multi-tab + theme-aware colors. Settings panel inference controls (6 sliders/inputs). CommandPalette theme commands + category grouping + new actions. Layout splitter double-click toggle + resize overlay. Range input + splitter hover CSS. |
| 2026-04-?? | Sections 10(Monaco),11(PTY),12(cursor),13(tools+shortcuts),15(error boundary+loading+git+search) | Feature Group 4: Monaco cursor tracking → StatusBar dynamic Ln/Col. SearchPanel with debounced search + file grouping. GitPanel with branch + staged/modified/untracked. ToolToggles (10 tools) + KeyboardShortcuts (15). ErrorBoundary wrapping app. Model loading overlay. Server: search/git/file-CRUD/PTY endpoints. BottomPanel XTermPanel rewritten for WebSocket PTY with exec fallback. || 2026-04-?? | Sections 2,5,6,8,9,10,12,15 | Feature Group 5: Monaco minimap toggle + diagnostics tracking. StatusBar dynamic branch + error/warning counts. Model picker: search/filter + family/size + status indicators + unload. System message rendering. Context indicator badge. CodeBlock download button. File explorer git status badges (M/A/?). Focus-visible styles. scale-in animation. Toast notifications marked complete. |
| 2026-04-?? | Sections 4,5,6,7,10,12,15 | Feature Group 6: TodoDropdown in chat input. CodeBlock line numbers toggle. StatusBar interactive items (cycle indent/encoding/EOL, click language). Selection badge in chat + status bar. Welcome screen enhanced (2-col, more shortcuts, kbd styling). NewProjectDialog modal. LaTeX/math rendering (remark-math + rehype-katex). Mermaid diagram rendering (MermaidBlock component). |
| 2026-03-27 | Sections 4,6,8,15,16 | Feature Group 7: Model favorites (star toggle, localStorage persisted, sorted to top). DebugPanel + ExtensionsPanel stubs. Ctrl+L/Ctrl+N shortcuts. Files changed bar (file pills with +N/-N). Streaming code block (auto-close unclosed fences). Cloud providers stubs (OpenAI/Anthropic/Gemini). Image/file attachments (paste + file input + previews). App icon (zzz.ico in TitleBar + favicon + Tauri). |
| | | |

/**
 * EditorArea — Tab bar + Monaco Editor, mimicking VS Code's editor group.
 * Shows a welcome screen when no files are open.
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import useAppStore from '../stores/appStore';
import DiffViewer from './DiffViewer';
import InlineChat from './InlineChat';
import BrowserPanel from './BrowserPanel';
import {
  isPreviewable, getPreviewType,
  HtmlPreview, MarkdownPreview, JsonPreview, CsvPreview, SvgPreview, ImagePreview
} from './EditorPreviews';
import FileIcon from './FileIcon';
import {
  X, Circle, FolderOpen, MessageSquare, Settings,
  FileText, Copy,
  Eye, Code2, Play, ExternalLink, Globe
} from 'lucide-react';

export default function EditorArea() {
  const openTabs = useAppStore(s => s.openTabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);
  const updateTabContent = useAppStore(s => s.updateTabContent);
  const addNotification = useAppStore(s => s.addNotification);
  const setEditorCursorPosition = useAppStore(s => s.setEditorCursorPosition);
  const setEditorDiagnostics = useAppStore(s => s.setEditorDiagnostics);
  const setEditorSelection = useAppStore(s => s.setEditorSelection);
  const minimapEnabled = useAppStore(s => s.settings.minimapEnabled);
  const editorIndentSize = useAppStore(s => s.editorIndentSize);
  const editorIndentType = useAppStore(s => s.editorIndentType);
  const diffState = useAppStore(s => s.diffState);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [inlineChat, setInlineChat] = useState(null);
  const [previewMode, setPreviewMode] = useState({}); // { [tabId]: boolean }
  const editorRef = useRef(null);
  const previewRequested = useAppStore(s => s.previewRequested);

  // R46-B: When Sidebar play button opens a file and sets previewRequested,
  // activate preview mode on the active tab
  useEffect(() => {
    if (previewRequested && activeTabId) {
      setPreviewMode(p => ({ ...p, [activeTabId]: true }));
      useAppStore.getState().setPreviewRequested(false);
    }
  }, [previewRequested, activeTabId]);

  const activeTab = openTabs.find(t => t.id === activeTabId);
  const addChatMessage = useAppStore(s => s.addChatMessage);

  // Ctrl+I — open inline chat at cursor
  useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.key === 'i' && editorRef.current) {
        e.preventDefault();
        const editor = editorRef.current;
        const pos = editor.getPosition();
        if (!pos) return;
        const coords = editor.getScrolledVisiblePosition(pos);
        const domNode = editor.getDomNode();
        const rect = domNode?.getBoundingClientRect();
        if (!coords || !rect) return;
        const sel = editor.getSelection();
        const model = editor.getModel();
        const selectedText = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
        setInlineChat({
          top: coords.top + rect.top + coords.height,
          left: coords.left + rect.left,
          selectedText,
        });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const handleTabContextMenu = (e, tabId) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleCloseTab = useCallback((tabId) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (tab?.modified) {
      if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
    }
    closeTab(tabId);
  }, [openTabs, closeTab]);

  const handleCloseOtherTabs = useCallback((tabId) => {
    openTabs.forEach(t => {
      if (t.id !== tabId) {
        if (!t.modified || confirm(`"${t.name}" has unsaved changes. Close anyway?`)) {
          closeTab(t.id);
        }
      }
    });
    setTabContextMenu(null);
  }, [openTabs, closeTab]);

  const handleCloseAllTabs = useCallback(() => {
    openTabs.forEach(t => {
      if (!t.modified || confirm(`"${t.name}" has unsaved changes. Close anyway?`)) {
        closeTab(t.id);
      }
    });
    setTabContextMenu(null);
  }, [openTabs, closeTab]);

  const handleCopyPath = useCallback((tabId) => {
    const tab = openTabs.find(t => t.id === tabId);
    if (tab) {
      navigator.clipboard.writeText(tab.path).catch(() => {});
      addNotification({ type: 'info', message: 'Path copied', duration: 2000 });
    }
    setTabContextMenu(null);
  }, [openTabs, addNotification]);

  if (openTabs.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab Bar */}
      <div className="flex h-tabbar bg-vsc-tab-border overflow-x-auto scrollbar-none no-select">
        {openTabs.map(tab => {
          const isHtml = tab.extension === 'html' || tab.extension === 'htm';
          const isBrowserTab = tab.type === 'browser';
          return (
            <div
              key={tab.id}
              className={`editor-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
            >
              {isBrowserTab ? <Globe size={14} className="text-vsc-accent flex-shrink-0" /> : <FileIcon extension={tab.extension} size={14} />}
              <span className="truncate text-vsc-sm">{tab.name}</span>
              {tab.modified && <Circle size={8} className="text-vsc-text-bright fill-current flex-shrink-0" />}
              {/* Play button for HTML files */}
              {isHtml && (
                <button
                  className="p-0.5 hover:bg-vsc-list-hover rounded text-vsc-success opacity-60 hover:opacity-100"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    // R46-B: Open preview in viewport instead of external browser
                    setPreviewMode(p => ({ ...p, [tab.id]: true }));
                  }}
                  title="Preview in viewport"
                >
                  <Play size={12} />
                </button>
              )}
              <button
                className="close-btn"
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Tab Context Menu */}
      {tabContextMenu && (
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          tabId={tabContextMenu.tabId}
          onClose={() => setTabContextMenu(null)}
          onCloseTab={handleCloseTab}
          onCloseOthers={handleCloseOtherTabs}
          onCloseAll={handleCloseAllTabs}
          onCopyPath={handleCopyPath}
        />
      )}

      {/* Breadcrumb */}
      {activeTab && (
        <div className="h-breadcrumb flex items-center px-3 bg-vsc-bg text-vsc-xs text-vsc-breadcrumb border-b border-vsc-panel-border no-select overflow-hidden min-w-0">
          <div className="flex items-center min-w-0 overflow-hidden flex-1">
          {activeTab.path.split(/[\\/]/).map((part, i, arr) => (
            <span key={i} className="shrink-0 last:shrink">
              {i > 0 && <span className="mx-1 text-vsc-text-dim">/</span>}
              <span className={`${i === arr.length - 1 ? 'text-vsc-text truncate' : 'hover:text-vsc-text cursor-pointer'}`}>
                {part}
              </span>
            </span>
          ))}
          </div>
          {/* Preview toggle button */}
          {isPreviewable(activeTab.path) && (
            <button
              className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
                previewMode[activeTab.id]
                  ? 'text-vsc-accent bg-vsc-accent/10'
                  : 'text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover'
              }`}
              onClick={() => setPreviewMode(p => ({ ...p, [activeTab.id]: !p[activeTab.id] }))}
              title={previewMode[activeTab.id] ? 'Show code' : 'Show preview'}
            >
              {previewMode[activeTab.id] ? <Code2 size={12} /> : <Eye size={12} />}
              {previewMode[activeTab.id] ? 'Code' : 'Preview'}
            </button>
          )}
        </div>
      )}

      {/* Monaco Editor, Diff Viewer, Preview, or Browser */}
      <div className="flex-1 min-h-0">
        {diffState ? (
          <DiffViewer />
        ) : activeTab && activeTab.type === 'browser' ? (
          <BrowserPanel />
        ) : activeTab && previewMode[activeTab.id] && getPreviewType(activeTab.path) ? (
          (() => {
            const type = getPreviewType(activeTab.path);
            const toggle = () => setPreviewMode(p => ({ ...p, [activeTab.id]: false }));
            switch (type) {
              case 'html': return <HtmlPreview content={activeTab.content} filePath={activeTab.path} onToggleCode={toggle} />;
              case 'markdown': return <MarkdownPreview content={activeTab.content} filePath={activeTab.path} onToggleCode={toggle} />;
              case 'json': return <JsonPreview content={activeTab.content} filePath={activeTab.path} onToggleCode={toggle} />;
              case 'csv': return <CsvPreview content={activeTab.content} filePath={activeTab.path} onToggleCode={toggle} />;
              case 'svg': return <SvgPreview content={activeTab.content} filePath={activeTab.path} onToggleCode={toggle} />;
              case 'image': return <ImagePreview filePath={activeTab.path} onToggleCode={toggle} />;
              default: return null;
            }
          })()
        ) : activeTab ? (
          <Editor
            key={activeTab.id}
            defaultLanguage={activeTab.language}
            language={activeTab.language}
            value={activeTab.content}
            theme="vs-dark"
            onChange={(value) => {
              if (value !== undefined) updateTabContent(activeTab.id, value);
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              // Track cursor position
              editor.onDidChangeCursorPosition((e) => {
                setEditorCursorPosition({
                  line: e.position.lineNumber,
                  column: e.position.column,
                });
              });
              // Set initial position
              const pos = editor.getPosition();
              if (pos) setEditorCursorPosition({ line: pos.lineNumber, column: pos.column });
              // Track text selection
              editor.onDidChangeCursorSelection((e) => {
                const sel = e.selection;
                if (sel.isEmpty()) {
                  setEditorSelection(null);
                } else {
                  const model = editor.getModel();
                  const text = model.getValueInRange(sel);
                  const lines = sel.endLineNumber - sel.startLineNumber + 1;
                  setEditorSelection({ chars: text.length, lines });
                }
              });
              // Track diagnostics (errors/warnings)
              monaco.editor.onDidChangeMarkers(([resource]) => {
                const markers = monaco.editor.getModelMarkers({ resource });
                let errors = 0, warnings = 0;
                for (const m of markers) {
                  if (m.severity === monaco.MarkerSeverity.Error) errors++;
                  else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
                }
                setEditorDiagnostics({ errors, warnings });
              });
            }}
            options={{
              fontSize: 14,
              fontFamily: 'Consolas, "Courier New", monospace',
              minimap: { enabled: minimapEnabled, scale: 1 },
              scrollBeyondLastLine: true,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              guides: { bracketPairs: true, indentation: true },
              wordWrap: 'off',
              tabSize: editorIndentSize,
              insertSpaces: editorIndentType === 'spaces',
              automaticLayout: true,
              padding: { top: 8 },
              lineNumbers: 'on',
              glyphMargin: true,
              folding: true,
              renderLineHighlight: 'all',
              scrollbar: {
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              parameterHints: { enabled: true },
              formatOnPaste: false,
              formatOnType: false,
            }}
            loading={
              <div className="flex items-center justify-center h-full text-vsc-text-dim">
                <div className="spinner mr-2" />
                Loading editor...
              </div>
            }
          />
        ) : null}
      </div>

      {/* Inline Chat Widget */}
      {inlineChat && (
        <InlineChat
          position={{ top: inlineChat.top, left: inlineChat.left }}
          onSubmit={(prompt) => {
            const prefix = inlineChat.selectedText
              ? `[Selected code]\n\`\`\`\n${inlineChat.selectedText}\n\`\`\`\n\n`
              : '';
            addChatMessage({ role: 'user', content: prefix + prompt });
            setInlineChat(null);
          }}
          onClose={() => setInlineChat(null)}
        />
      )}
    </div>
  );
}

function WelcomeScreen() {
  const setActiveActivity = useAppStore(s => s.setActiveActivity);
  const toggleChatPanel = useAppStore(s => s.toggleChatPanel);
  const openCommandPalette = useAppStore(s => s.openCommandPalette);

  const openFolder = () => {
    const doOpen = (path) => {
      if (!path) return;
      fetch('/api/project/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: path }),
      }).then(r => r.json()).then(d => {
        if (d.success) {
          useAppStore.getState().setProjectPath(d.path);
          fetch(`/api/files/tree?path=${encodeURIComponent(d.path)}`)
            .then(r => r.json())
            .then(t => useAppStore.getState().setFileTree(t.items || []))
            .catch(() => {});
        }
      }).catch(() => {});
    };

    if (window.electronAPI?.openFolderDialog) {
      window.electronAPI.openFolderDialog().then(result => {
        if (result) doOpen(result);
      });
    } else {
      const path = prompt('Enter folder path to open:');
      if (path) doOpen(path);
    }
  };

  return (
    <div className="welcome-tab relative overflow-hidden">
      {/* Animated wavy lines — thin dashed strokes, theme-reactive */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg className="absolute bottom-0 left-0 w-full h-full" viewBox="0 0 1200 400" preserveAspectRatio="none">
          <path fill="none" stroke="currentColor" className="text-vsc-accent" strokeWidth="0.8" strokeDasharray="10 8" opacity="0.10"
            d="M-100,300 C50,260 200,340 400,280 C600,220 800,320 1000,270 C1200,220 1350,300 1500,260">
            <animateTransform attributeName="transform" type="translate" values="0,0;-30,0;0,0" dur="25s" repeatCount="indefinite" />
          </path>
          <path fill="none" stroke="currentColor" className="text-vsc-accent" strokeWidth="0.6" strokeDasharray="6 12" opacity="0.06"
            d="M-50,365 C100,330 250,385 450,340 C650,295 850,370 1050,325 C1250,280 1400,355 1550,315">
            <animateTransform attributeName="transform" type="translate" values="0,0;20,0;0,0" dur="35s" repeatCount="indefinite" />
          </path>
        </svg>
        {/* Radial glow behind content */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[300px] h-[200px] rounded-full bg-vsc-accent/[0.03]" style={{ filter: 'blur(80px)' }} />
      </div>

      <div
        className="relative z-10 w-12 h-12 mb-3 bg-vsc-accent mx-auto"
        style={{ mask: 'url(/icon.png) center/contain no-repeat', WebkitMask: 'url(/icon.png) center/contain no-repeat' }}
      />
      <h1 className="font-brand text-vsc-accent relative z-10">guIDE</h1>
      <p className="relative z-10">Local-first AI-powered IDE. Zero cloud dependency.</p>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 w-full max-w-xl mx-auto text-left relative z-10">
        {/* Start */}
        <div>
          <h3 className="text-vsc-xs font-semibold text-vsc-text-dim uppercase tracking-wider mb-2">Start</h3>
          <div className="flex flex-col gap-1">
            <button className="welcome-action" onClick={openFolder}>
              <FolderOpen size={16} />
              Open Folder...
            </button>
            <button className="welcome-action" onClick={toggleChatPanel}>
              <MessageSquare size={16} />
              Open AI Chat
            </button>
            <button className="welcome-action" onClick={() => setActiveActivity('settings')}>
              <Settings size={16} />
              Configure Model
            </button>
            <button className="welcome-action" onClick={openCommandPalette}>
              <FileText size={16} />
              Command Palette
            </button>
          </div>
        </div>

        {/* Shortcuts */}
        <div>
          <h3 className="text-vsc-xs font-semibold text-vsc-text-dim uppercase tracking-wider mb-2">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-vsc-xs">
            <kbd className="kbd">Ctrl+Shift+P</kbd><span className="text-vsc-text">Command Palette</span>
            <kbd className="kbd">Ctrl+B</kbd><span className="text-vsc-text">Toggle Sidebar</span>
            <kbd className="kbd">Ctrl+J</kbd><span className="text-vsc-text">Toggle Panel</span>
            <kbd className="kbd">Ctrl+S</kbd><span className="text-vsc-text">Save File</span>
            <kbd className="kbd">Ctrl+L</kbd><span className="text-vsc-text">Toggle AI Chat</span>
            <kbd className="kbd">Ctrl+P</kbd><span className="text-vsc-text">Quick Open</span>
            <kbd className="kbd">Ctrl+/</kbd><span className="text-vsc-text">Toggle Comment</span>
            <kbd className="kbd">Ctrl+`</kbd><span className="text-vsc-text">Toggle Terminal</span>
          </div>
        </div>
      </div>

      <p className="mt-8 text-[10px] text-vsc-text-dim/50 relative z-10">guIDE — Built for local AI inference</p>
    </div>
  );
}



function TabContextMenu({ x, y, tabId, onClose, onCloseTab, onCloseOthers, onCloseAll, onCopyPath }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const style = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 180),
    zIndex: 9999,
  };

  return (
    <div ref={menuRef} className="context-menu" style={style}>
      <button className="context-menu-item" onClick={() => { onCloseTab(tabId); onClose(); }}>
        <X size={14} className="mr-2 text-vsc-text-dim" /> Close
      </button>
      <button className="context-menu-item" onClick={() => onCloseOthers(tabId)}>
        <X size={14} className="mr-2 text-vsc-text-dim" /> Close Others
      </button>
      <button className="context-menu-item" onClick={() => onCloseAll()}>
        <X size={14} className="mr-2 text-vsc-text-dim" /> Close All
      </button>
      <div className="context-menu-separator" />
      <button className="context-menu-item" onClick={() => onCopyPath(tabId)}>
        <Copy size={14} className="mr-2 text-vsc-text-dim" /> Copy Path
      </button>
    </div>
  );
}

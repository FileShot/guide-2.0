/**
 * BottomPanel — Terminal, Output, and Problems tabs.
 * Terminal uses xterm.js for proper terminal rendering.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '../stores/appStore';
import { Terminal as TerminalIcon, FileOutput, AlertTriangle, X, Plus, Trash2 } from 'lucide-react';

const panelTabs = [
  { id: 'terminal', label: 'TERMINAL', icon: TerminalIcon },
  { id: 'output', label: 'OUTPUT', icon: FileOutput },
  { id: 'problems', label: 'PROBLEMS', icon: AlertTriangle },
];

export default function BottomPanel() {
  const activePanelTab = useAppStore(s => s.activePanelTab);
  const setActivePanelTab = useAppStore(s => s.setActivePanelTab);
  const togglePanel = useAppStore(s => s.togglePanel);
  const terminalTabs = useAppStore(s => s.terminalTabs);
  const activeTerminalTab = useAppStore(s => s.activeTerminalTab);
  const setActiveTerminalTab = useAppStore(s => s.setActiveTerminalTab);
  const addTerminalTab = useAppStore(s => s.addTerminalTab);
  const closeTerminalTab = useAppStore(s => s.closeTerminalTab);

  return (
    <div className="flex flex-col h-full bg-vsc-panel">
      {/* Tab bar */}
      <div className="flex items-center h-[35px] border-b border-vsc-panel-border no-select flex-shrink-0">
        <div className="flex items-center flex-1">
          {panelTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`panel-tab ${activePanelTab === id ? 'active' : ''}`}
              onClick={() => setActivePanelTab(id)}
            >
              <Icon size={14} className="mr-1.5" />
              {label}
            </button>
          ))}

          {/* Terminal sub-tabs (when terminal is active) */}
          {activePanelTab === 'terminal' && (
            <div className="flex items-center ml-2 border-l border-vsc-panel-border/50 pl-2 gap-0.5">
              {terminalTabs.map(tab => (
                <div
                  key={tab.id}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${
                    activeTerminalTab === tab.id
                      ? 'bg-vsc-list-active text-vsc-text-bright'
                      : 'text-vsc-text-dim hover:bg-vsc-list-hover hover:text-vsc-text'
                  }`}
                  onClick={() => setActiveTerminalTab(tab.id)}
                >
                  <TerminalIcon size={11} />
                  <span>{tab.name}</span>
                  {terminalTabs.length > 1 && (
                    <button
                      className="hover:text-vsc-error ml-0.5"
                      onClick={(e) => { e.stopPropagation(); closeTerminalTab(tab.id); }}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              ))}
              <button
                className="p-0.5 hover:bg-vsc-list-hover rounded text-vsc-text-dim hover:text-vsc-text"
                onClick={addTerminalTab}
                title="New Terminal"
              >
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 pr-2">
          <button className="p-1 hover:bg-vsc-list-hover rounded" title="Clear">
            <Trash2 size={14} className="text-vsc-text-dim" />
          </button>
          <button className="p-1 hover:bg-vsc-list-hover rounded" title="Close Panel" onClick={togglePanel}>
            <X size={14} className="text-vsc-text-dim" />
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activePanelTab === 'terminal' && <XTermPanel />}
        {activePanelTab === 'output' && <OutputPanel />}
        {activePanelTab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  );
}

function XTermPanel() {
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const modeRef = useRef(null); // 'pty' | 'exec' | null
  const [loaded, setLoaded] = useState(false);
  const activeTerminalTab = useAppStore(s => s.activeTerminalTab);

  // Initialize xterm.js + WebSocket PTY
  useEffect(() => {
    let term = null;
    let fitAddon = null;
    let ws = null;
    let disposed = false;

    async function initXterm() {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');

        if (disposed) return;

        // Get theme colors from CSS variables
        const style = getComputedStyle(document.documentElement);
        const getColor = (name) => {
          const val = style.getPropertyValue(`--guide-${name}`).trim();
          if (!val) return undefined;
          const parts = val.split(' ').map(Number);
          if (parts.length === 3) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
          return undefined;
        };

        term = new Terminal({
          fontFamily: '"Cascadia Code", "Fira Code", Consolas, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.4,
          cursorBlink: true,
          cursorStyle: 'bar',
          scrollback: 5000,
          theme: {
            background: getColor('terminal-bg') || '#0a0a0a',
            foreground: getColor('terminal-fg') || '#b4b4b4',
            cursor: getColor('terminal-cursor') || '#ff6b00',
            selectionBackground: getColor('selection') || 'rgba(60, 40, 10, 0.5)',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5',
          },
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        if (!termRef.current || disposed) return;

        term.open(termRef.current);
        fitAddon.fit();
        xtermRef.current = term;
        fitAddonRef.current = fitAddon;
        setLoaded(true);

        // Connect to PTY WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          // Request a PTY process
          ws.send(JSON.stringify({
            type: 'create',
            terminalId: activeTerminalTab,
            cols: term.cols,
            rows: term.rows,
          }));
        };

        ws.onmessage = (event) => {
          let msg;
          try { msg = JSON.parse(event.data); } catch (_) { return; }

          if (msg.type === 'output') {
            term.write(msg.data);
          } else if (msg.type === 'ready') {
            modeRef.current = 'pty';
          } else if (msg.type === 'no-pty') {
            // Fall back to exec mode
            modeRef.current = 'exec';
            term.writeln('Terminal');
            term.writeln('\x1b[90mnode-pty not available — using command execution fallback\x1b[0m');
            term.writeln('');
            term.write('> ');
            _setupExecMode(term);
          } else if (msg.type === 'exit') {
            term.writeln(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m`);
          }
        };

        ws.onerror = () => {
          // WebSocket failed — use exec fallback
          if (!modeRef.current) {
            modeRef.current = 'exec';
            term.writeln('Terminal');
            term.writeln('\x1b[90mUsing command execution mode\x1b[0m');
            term.writeln('');
            term.write('> ');
            _setupExecMode(term);
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
        };

        // PTY mode: forward all input directly to server
        term.onData((data) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && modeRef.current === 'pty') {
            wsRef.current.send(JSON.stringify({ type: 'input', data }));
          }
        });

      } catch (err) {
        console.error('Failed to initialize xterm:', err);
      }
    }

    initXterm();

    return () => {
      disposed = true;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      if (term) {
        term.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
        wsRef.current = null;
      }
    };
  }, [activeTerminalTab]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          // Notify PTY of new size
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && xtermRef.current) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            }));
          }
        } catch {}
      }
    };
    const observer = new ResizeObserver(handleResize);
    if (termRef.current) observer.observe(termRef.current);
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [loaded]);

  // R39-A3: Sync xterm theme when app theme changes (class attribute on <html>)
  useEffect(() => {
    if (!xtermRef.current) return;
    const observer = new MutationObserver(() => {
      if (!xtermRef.current) return;
      const style = getComputedStyle(document.documentElement);
      const getColor = (name) => {
        const val = style.getPropertyValue(`--guide-${name}`).trim();
        if (!val) return undefined;
        const parts = val.split(' ').map(Number);
        if (parts.length === 3) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
        return undefined;
      };
      xtermRef.current.options.theme = {
        background: getColor('terminal-bg') || '#0a0a0a',
        foreground: getColor('terminal-fg') || '#b4b4b4',
        cursor: getColor('terminal-cursor') || '#ff6b00',
        selectionBackground: getColor('selection') || 'rgba(60, 40, 10, 0.5)',
      };
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [loaded]);

  return (
    <div className="h-full w-full relative">
      <div
        ref={termRef}
        className="h-full w-full xterm-container"
        style={{ padding: '4px 0 0 8px' }}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-vsc-text-dim text-vsc-sm">
          <div className="spinner mr-2" />
          Loading terminal...
        </div>
      )}
    </div>
  );
}

/** Exec fallback: line-by-line command execution when PTY is not available */
function _setupExecMode(term) {
  let currentLine = '';
  term.onData((data) => {
    if (data === '\r') {
      term.writeln('');
      if (currentLine.trim()) {
        fetch('/api/terminal/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: currentLine }),
        }).then(r => r.json()).then(d => {
          if (d.output) term.writeln(d.output);
          if (!d.success && d.output) term.writeln(`\x1b[31m${d.output}\x1b[0m`);
          term.write('\x1b[38;2;255;107;0m>\x1b[0m ');
        }).catch(err => {
          term.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
          term.write('\x1b[38;2;255;107;0m>\x1b[0m ');
        });
      } else {
        term.write('\x1b[38;2;255;107;0m>\x1b[0m ');
      }
      currentLine = '';
    } else if (data === '\x7f') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        term.write('\b \b');
      }
    } else if (data >= ' ') {
      currentLine += data;
      term.write(data);
    }
  });
}

function OutputPanel() {
  return (
    <div className="h-full p-2 overflow-y-auto scrollbar-thin font-vsc-code text-vsc-sm text-vsc-text-dim">
      <div className="text-vsc-xs">Output channel - AI generation logs will appear here</div>
    </div>
  );
}

function ProblemsPanel() {
  return (
    <div className="h-full p-2 overflow-y-auto scrollbar-thin text-vsc-sm">
      <div className="flex items-center gap-2 text-vsc-text-dim text-vsc-xs">
        <AlertTriangle size={14} />
        <span>No problems detected in workspace</span>
      </div>
    </div>
  );
}

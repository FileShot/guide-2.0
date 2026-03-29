/**
 * CodeBlock — Syntax-highlighted code block with toolbar.
 * Features: language label, copy button, line numbers, apply-to-file stub.
 * Receives pre-highlighted HTML from rehype-highlight (via MarkdownRenderer).
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check, FileDown, WrapText, Download, Hash, ChevronDown, ChevronRight } from 'lucide-react';

const COLLAPSE_LINE_THRESHOLD = 10;

export default function CodeBlock({ language, children, className }) {
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const codeRef = useRef(null);

  // Extract text content from children (may be React elements from rehype-highlight)
  const getTextContent = useCallback(() => {
    if (codeRef.current) {
      return codeRef.current.textContent || '';
    }
    if (typeof children === 'string') return children;
    return '';
  }, [children]);

  const handleCopy = useCallback(async () => {
    const text = getTextContent();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [getTextContent]);

  const handleApply = useCallback(() => {
    // Stub — will integrate with editor tab system later
  }, []);

  const handleDownload = useCallback(() => {
    const text = getTextContent();
    const ext = langDisplay || 'txt';
    const extMap = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', json: 'json', rust: 'rs', go: 'go', java: 'java', ruby: 'rb', php: 'php', shell: 'sh', markdown: 'md' };
    const fileExt = extMap[ext] || ext;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${fileExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getTextContent]);

  // Ref+interval pattern: MutationObserver updates ref (no re-render),
  // 500ms interval syncs ref to state (max 2 re-renders/sec, avoids React #185)
  const [lineCount, setLineCount] = useState(0);
  const lineCountRef = useRef(0);
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;

    const syncCount = () => {
      const text = el.textContent || '';
      const count = text ? text.split('\n').length : 0;
      if (count !== lineCountRef.current) {
        lineCountRef.current = count;
        setLineCount(count);
      }
    };

    // Initial count
    syncCount();

    // Watch for DOM changes — write to ref only (no state update)
    const observer = new MutationObserver(() => {
      const text = el.textContent || '';
      lineCountRef.current = text ? text.split('\n').length : 0;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    // Sync ref to state at fixed interval
    const interval = setInterval(syncCount, 500);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);
  const isCollapsible = lineCount > COLLAPSE_LINE_THRESHOLD;
  const isCollapsed = collapsed && isCollapsible;

  // Normalize language display
  const langDisplay = (language || '').replace(/^language-/, '');

  return (
    <div className="code-block-container group relative my-2 rounded-md overflow-hidden border border-vsc-panel-border/40">
      {/* Header bar */}
      <div className="code-block-header flex items-center justify-between px-3 py-1 bg-vsc-sidebar/80 border-b border-vsc-panel-border/30">
        <span className="text-[11px] text-vsc-text-dim font-medium uppercase tracking-wide">
          {langDisplay || 'text'}{lineCount > 0 && ` (${lineCount} lines)`}
        </span>
        <div className="flex items-center gap-0.5">
          {/* Word wrap toggle */}
          <button
            className={`p-1 rounded-sm transition-colors ${
              wordWrap ? 'text-vsc-accent bg-vsc-accent/10' : 'text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover'
            }`}
            onClick={() => setWordWrap(!wordWrap)}
            title="Toggle word wrap"
          >
            <WrapText size={13} />
          </button>
          {/* Line numbers toggle */}
          <button
            className={`p-1 rounded-sm transition-colors ${
              showLineNumbers ? 'text-vsc-accent bg-vsc-accent/10' : 'text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover'
            }`}
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            title="Toggle line numbers"
          >
            <Hash size={13} />
          </button>
          {/* Download */}
          <button
            className="p-1 rounded-sm text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover transition-colors"
            onClick={handleDownload}
            title="Download code"
          >
            <Download size={13} />
          </button>
          {/* Apply to file */}
          <button
            className="p-1 rounded-sm text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover transition-colors"
            onClick={handleApply}
            title="Apply to file"
          >
            <FileDown size={13} />
          </button>
          {/* Copy */}
          <button
            className={`p-1 rounded-sm transition-colors ${
              copied ? 'text-vsc-success' : 'text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover'
            }`}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Code content */}
      <div className="relative">
        <div className={`overflow-x-auto ${wordWrap ? 'code-wrap' : ''} ${isCollapsed ? 'max-h-[240px] overflow-y-hidden' : 'max-h-[500px] overflow-y-auto'}`}>
          <pre className="!m-0 !rounded-none !border-0 p-3 text-vsc-sm leading-relaxed bg-vsc-bg">
            {showLineNumbers && lineCount > 0 && (
              <span className="code-line-numbers select-none pr-4 text-vsc-text-dim/40 text-right inline-block" style={{ width: `${String(lineCount).length * 0.7 + 1.5}em` }}>
                {Array.from({ length: lineCount }, (_, i) => (
                  <span key={i} className="block">{i + 1}</span>
                ))}
              </span>
            )}
            <code ref={codeRef} className={className}>
              {children}
            </code>
          </pre>
        </div>
        {/* Gradient fade + expand button when collapsed */}
        {isCollapsed && (
          <div className="absolute bottom-0 left-0 right-0">
            <div className="h-12 bg-gradient-to-t from-vsc-bg to-transparent pointer-events-none" />
            <button
              className="w-full py-1.5 bg-vsc-bg text-vsc-xs text-vsc-accent hover:text-vsc-accent-hover flex items-center justify-center gap-1 border-t border-vsc-panel-border/20"
              onClick={() => setCollapsed(false)}
            >
              <ChevronDown size={12} />
              Show more ({lineCount} lines)
            </button>
          </div>
        )}
        {/* Collapse button when expanded and collapsible */}
        {!collapsed && isCollapsible && (
          <button
            className="w-full py-1 bg-vsc-sidebar/60 text-vsc-xs text-vsc-text-dim hover:text-vsc-text flex items-center justify-center gap-1 border-t border-vsc-panel-border/20"
            onClick={() => setCollapsed(true)}
          >
            <ChevronRight size={12} className="rotate-[-90deg]" />
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

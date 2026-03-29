/**
 * FileContentBlock — Renders a single file being generated via file-content events.
 * Shows filename, growing line count, raw content, collapse/expand, copy, download.
 * Uses ref+interval for line counting to avoid React #185.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Copy, Check, Download, ChevronDown, ChevronRight, FileCode, Loader } from 'lucide-react';

const COLLAPSE_THRESHOLD = 15;
const LINE_COUNT_INTERVAL = 500;

export default function FileContentBlock({ filePath, language, fileName, content, complete }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const contentRef = useRef(null);
  const lineCountRef = useRef(0);
  const [lineCount, setLineCount] = useState(0);

  // Ref+interval pattern: MutationObserver updates ref, interval syncs to state
  useEffect(() => {
    const el = contentRef.current;
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

    // Watch for DOM changes
    const observer = new MutationObserver(() => {
      const text = el.textContent || '';
      lineCountRef.current = text ? text.split('\n').length : 0;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    // Sync ref to state at fixed interval (max 2 re-renders/sec)
    const interval = setInterval(syncCount, LINE_COUNT_INTERVAL);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  const handleDownload = useCallback(() => {
    const name = fileName || filePath || 'file.txt';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.split('/').pop().split('\\').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, fileName, filePath]);

  const displayName = fileName || (filePath ? filePath.split(/[/\\]/).pop() : 'file');
  const isCollapsible = lineCount > COLLAPSE_THRESHOLD;
  // R22-Fix5: Use content length as a proxy before lineCount is measured.
  // This prevents the flash-full-then-collapse glitch on first render.
  const likelyLong = content.length > 500;
  const isCollapsed = collapsed && (isCollapsible || (lineCount === 0 && likelyLong));

  return (
    <div className="code-block-container group relative my-2 rounded-md overflow-hidden border border-vsc-panel-border/40">
      {/* Header */}
      <div className="code-block-header flex items-center justify-between px-3 py-1 bg-vsc-sidebar/80 border-b border-vsc-panel-border/30">
        <div className="flex items-center gap-1.5">
          <FileCode size={12} className="text-vsc-accent" />
          <span className="text-[11px] text-vsc-text font-medium">{displayName}</span>
          {language && <span className="text-[10px] text-vsc-text-dim uppercase">{language}</span>}
          {lineCount > 0 && <span className="text-[10px] text-vsc-text-dim">({lineCount} lines)</span>}
          {!complete && <Loader size={10} className="animate-spin text-vsc-accent ml-1" />}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className="p-1 rounded-sm text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover transition-colors"
            onClick={handleDownload}
            title="Download file"
          >
            <Download size={13} />
          </button>
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

      {/* Content */}
      <div className="relative">
        <div className={`overflow-x-auto ${isCollapsed ? 'max-h-[240px] overflow-y-hidden' : 'max-h-[500px] overflow-y-auto'}`}>
          <pre className="!m-0 !rounded-none !border-0 p-3 text-vsc-sm leading-relaxed bg-vsc-bg">
            <code ref={contentRef}>{content}</code>
          </pre>
        </div>
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
        {!collapsed && (isCollapsible || likelyLong) && (
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

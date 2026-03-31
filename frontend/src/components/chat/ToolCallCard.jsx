/**
 * ToolCallCard — Compact single-line tool call display, VS Code style.
 * Shows tool name + status inline. Click to expand params/result.
 */
import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader, Check, X, Wrench } from 'lucide-react';

const statusConfig = {
  pending: { icon: Loader, color: 'text-vsc-accent', spin: true, label: 'Running' },
  success: { icon: Check, color: 'text-vsc-success', spin: false, label: '' },
  error: { icon: X, color: 'text-vsc-error', spin: false, label: 'Failed' },
};

export default function ToolCallCard({ toolCall, count }) {
  const [expanded, setExpanded] = useState(false);

  const { functionName, params, result, status = 'pending', duration } = toolCall;
  const config = statusConfig[status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="my-0.5">
      {/* Compact header — single line */}
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left rounded hover:bg-vsc-list-hover/40 transition-colors border-l-2 border-vsc-accent/40"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={11} className="text-vsc-text-dim flex-shrink-0" /> : <ChevronRight size={11} className="text-vsc-text-dim flex-shrink-0" />}
        <Wrench size={11} className="text-vsc-text-dim flex-shrink-0" />
        <span className="text-vsc-xs text-vsc-text truncate">{functionName}</span>
        {count > 1 && (
          <span className="text-[10px] px-1 py-px rounded bg-vsc-accent/15 text-vsc-accent font-medium flex-shrink-0">
            x{count}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {duration > 0 && (
            <span className="text-[10px] text-vsc-text-dim">{duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}</span>
          )}
          <StatusIcon
            size={11}
            className={`${config.color} ${config.spin ? 'animate-spin' : ''}`}
          />
          {config.label && <span className={`text-[10px] ${config.color}`}>{config.label}</span>}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="ml-4 pl-2 border-l border-vsc-panel-border/30 mt-0.5 mb-1">
          {params && (
            <div className="mb-1">
              <div className="text-[10px] text-vsc-text-dim uppercase tracking-wider font-medium mb-0.5">Parameters</div>
              <pre className="text-[10px] text-vsc-text-dim overflow-auto max-h-[150px] whitespace-pre-wrap font-vsc-code bg-vsc-sidebar/50 rounded px-1.5 py-1">
                {typeof params === 'string' ? params : JSON.stringify(params, null, 2)}
              </pre>
            </div>
          )}
          {result !== undefined && result !== null && (
            <div>
              <div className="text-[10px] text-vsc-text-dim uppercase tracking-wider font-medium mb-0.5">Result</div>
              <pre className={`text-[10px] overflow-auto max-h-[150px] whitespace-pre-wrap font-vsc-code bg-vsc-sidebar/50 rounded px-1.5 py-1 ${
                status === 'error' ? 'text-vsc-error' : 'text-vsc-text-dim'
              }`}>
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

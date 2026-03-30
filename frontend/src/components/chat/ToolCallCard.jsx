/**
 * ToolCallCard — Displays a tool call with collapsible params/result sections.
 * Shows tool name, execution status, timing, and output.
 */
import { useState } from 'react';
import { ChevronRight, ChevronDown, Loader, Check, X, Wrench } from 'lucide-react';

const statusConfig = {
  pending: { icon: Loader, color: 'text-vsc-accent', spin: true, label: 'Running' },
  success: { icon: Check, color: 'text-vsc-success', spin: false, label: 'Done' },
  error: { icon: X, color: 'text-vsc-error', spin: false, label: 'Failed' },
};

export default function ToolCallCard({ toolCall }) {
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);

  const { functionName, params, result, status = 'pending', duration } = toolCall;
  const config = statusConfig[status] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="tool-call-card my-2 rounded-lg border border-vsc-panel-border/40 bg-vsc-sidebar/50 overflow-hidden shadow-sm"
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.15), 0 1px 0 rgba(255,255,255,0.02) inset' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Wrench size={13} className="text-vsc-text-dim flex-shrink-0" />
        <span className="text-vsc-sm font-medium text-vsc-text truncate">{functionName}</span>
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {duration && (
            <span className="text-[11px] text-vsc-text-dim">{duration}ms</span>
          )}
          <StatusIcon
            size={13}
            className={`${config.color} ${config.spin ? 'animate-spin' : ''}`}
          />
          <span className={`text-[11px] ${config.color}`}>{config.label}</span>
        </div>
      </div>

      {/* Params section */}
      {params && (
        <div className="border-t border-vsc-panel-border/20">
          <button
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover transition-colors"
            onClick={() => setParamsExpanded(!paramsExpanded)}
          >
            {paramsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span className="uppercase tracking-wider font-medium">Parameters</span>
          </button>
          {paramsExpanded && (
            <pre className="px-3 pb-2 text-[11px] text-vsc-text-dim overflow-auto max-h-[200px] whitespace-pre-wrap font-vsc-code">
              {typeof params === 'string' ? params : JSON.stringify(params, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Result section */}
      {result !== undefined && result !== null && (
        <div className="border-t border-vsc-panel-border/20">
          <button
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-vsc-text-dim hover:text-vsc-text hover:bg-vsc-list-hover transition-colors"
            onClick={() => setResultExpanded(!resultExpanded)}
          >
            {resultExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span className="uppercase tracking-wider font-medium">Result</span>
          </button>
          {resultExpanded && (
            <pre className={`px-3 pb-2 text-[11px] overflow-auto max-h-[200px] whitespace-pre-wrap font-vsc-code ${
              status === 'error' ? 'text-vsc-error' : 'text-vsc-text-dim'
            }`}>
              {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

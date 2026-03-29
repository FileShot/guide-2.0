/**
 * ChatPanel — AI chat interface with streaming markdown rendering.
 * Features a cohesive unified input container with toolbar.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import useAppStore from '../stores/appStore';
import MarkdownRenderer from './chat/MarkdownRenderer';
import ToolCallCard from './chat/ToolCallCard';
import FileContentBlock from './chat/FileContentBlock';
import { Virtuoso } from 'react-virtuoso';
import {
  Send, Square, Trash2, Cpu, Loader, ChevronDown, ChevronRight, Brain,
  Paperclip, Mic, Zap, FileCode, ArrowUp, ChevronUp, Plus, Minus,
  Check, Undo2, X, Star, GripVertical, RotateCcw, Clock, Settings,
  Cloud, Key, FolderPlus, Sparkles, Eye, ImageIcon
} from 'lucide-react';

export default function ChatPanel() {
  const chatMessages = useAppStore(s => s.chatMessages);
  const chatStreaming = useAppStore(s => s.chatStreaming);
  const chatStreamingText = useAppStore(s => s.chatStreamingText);
  const chatThinkingText = useAppStore(s => s.chatThinkingText);
  const chatGeneratingTool = useAppStore(s => s.chatGeneratingTool);
  const chatContextUsage = useAppStore(s => s.chatContextUsage);
  const chatIteration = useAppStore(s => s.chatIteration);
  const modelInfo = useAppStore(s => s.modelInfo);
  const modelLoaded = useAppStore(s => s.modelLoaded);
  const projectPath = useAppStore(s => s.projectPath);
  const addChatMessage = useAppStore(s => s.addChatMessage);
  const setChatStreaming = useAppStore(s => s.setChatStreaming);
  const clearChat = useAppStore(s => s.clearChat);
  const todos = useAppStore(s => s.todos);
  const connected = useAppStore(s => s.connected);
  const availableModels = useAppStore(s => s.availableModels);
  const activeTabId = useAppStore(s => s.activeTabId);
  const openTabs = useAppStore(s => s.openTabs);
  const editorSelection = useAppStore(s => s.editorSelection);
  const setActiveActivity = useAppStore(s => s.setActiveActivity);

  const chatFilesChanged = useAppStore(s => s.chatFilesChanged);
  const setChatFilesChanged = useAppStore(s => s.setChatFilesChanged);
  const chatAttachments = useAppStore(s => s.chatAttachments);
  const addChatAttachment = useAppStore(s => s.addChatAttachment);
  const removeChatAttachment = useAppStore(s => s.removeChatAttachment);
  const clearChatAttachments = useAppStore(s => s.clearChatAttachments);
  const streamingFileBlocks = useAppStore(s => s.streamingFileBlocks);
  const messageQueue = useAppStore(s => s.messageQueue);
  const addQueuedMessage = useAppStore(s => s.addQueuedMessage);
  const removeQueuedMessage = useAppStore(s => s.removeQueuedMessage);
  const updateQueuedMessage = useAppStore(s => s.updateQueuedMessage);
  const cloudProvider = useAppStore(s => s.cloudProvider);

  const [input, setInput] = useState('');
  const [autoMode, setAutoMode] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const [filesChangedExpanded, setFilesChangedExpanded] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFileAttach = useCallback((files) => {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      addChatAttachment({
        name: file.name,
        type: file.type,
        url,
        size: file.size,
      });
    }
  }, [addChatAttachment]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleFileAttach([file]);
      }
    }
  }, [handleFileAttach]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      handleFileAttach(Array.from(e.dataTransfer.files));
    }
  }, [handleFileAttach]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = '28px';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatStreaming) return;

    setInput('');
    addChatMessage({ role: 'user', content: text });

    const store = useAppStore.getState();
    store.setChatStreaming(true);

    try {
      const activeTab = store.openTabs.find(t => t.id === store.activeTabId);
      const s = store.settings;
      const result = await (await import('../api/websocket')).invoke('ai-chat', text, {
        projectPath: store.projectPath,
        currentFile: activeTab ? { path: activeTab.path, content: activeTab.content } : null,
        selectedCode: null,
        conversationHistory: [],
        cloudProvider: store.cloudProvider,
        cloudModel: store.cloudModel,
        params: {
          autoMode,
          planMode,
          temperature: s.temperature,
          maxTokens: s.maxResponseTokens,
          topP: s.topP,
          topK: s.topK,
          repeatPenalty: s.repeatPenalty,
          seed: s.seed,
          thinkingBudget: s.thinkingBudget,
          reasoningEffort: s.reasoningEffort,
          maxIterations: s.maxIterations,
          generationTimeoutSec: s.generationTimeoutSec,
          snapshotMaxChars: s.snapshotMaxChars,
          enableThinkingFilter: s.enableThinkingFilter,
          enableGrammar: s.enableGrammar,
          systemPrompt: s.systemPrompt,
          customInstructions: s.customInstructions,
          gpuPreference: s.gpuPreference,
          gpuLayers: s.gpuLayers,
          contextSize: s.contextSize,
        },
      });

      // Finalization: compose file blocks as markdown fences
      // R27-B: Use fresh getState() — store snapshot from L125 is stale after long await
      const finalText = useAppStore.getState().chatStreamingText || result?.text || '';
      const fileBlocks = useAppStore.getState().streamingFileBlocks;
      let messageContent = finalText;
      if (fileBlocks.length > 0) {
        for (const block of fileBlocks) {
          messageContent += `\n\`\`\`${block.language || 'text'}\n${block.content}\n\`\`\`\n`;
        }
        useAppStore.getState().clearFileContentBlocks();
      }
      if (messageContent) {
        useAppStore.getState().addChatMessage({ role: 'assistant', content: messageContent });
      }
    } catch (err) {
      useAppStore.getState().addChatMessage({ role: 'assistant', content: `Error: ${err.message}` });
    } finally {
      useAppStore.getState().setChatStreaming(false);
    }
  }, [input, chatStreaming, addChatMessage, autoMode, planMode]);

  const handleStop = useCallback(async () => {
    try {
      await (await import('../api/websocket')).invoke('agent-pause');
    } catch (_) {}
  }, []);

  const handleClear = useCallback(async () => {
    clearChat();
    try {
      await fetch('/api/session/clear', { method: 'POST' });
    } catch (_) {}
  }, [clearChat]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const contextPct = chatContextUsage
    ? Math.round((chatContextUsage.used / chatContextUsage.total) * 100)
    : 0;

  const modelDisplayName = cloudProvider
    ? (cloudProvider === 'graysoft' ? 'Cloud AI' : cloudProvider.charAt(0).toUpperCase() + cloudProvider.slice(1))
    : modelInfo
      ? (modelInfo.family || modelInfo.name || '').split('/').pop().slice(0, 20)
      : 'No Model';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-[35px] flex items-center justify-between px-3 border-b border-vsc-panel-border/50 no-select flex-shrink-0">
        <div className="flex items-center gap-2 text-vsc-sm font-medium text-vsc-text">
          <span className="text-vsc-text">Chat</span>
          {chatStreaming && <Loader size={12} className="animate-spin text-vsc-accent" />}
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1 hover:bg-vsc-list-hover rounded" title="New Chat" onClick={handleClear}>
            <Plus size={14} className="text-vsc-text-dim" />
          </button>
          <button className="p-1 hover:bg-vsc-list-hover rounded" title="Settings" onClick={() => setActiveActivity('settings')}>
            <Settings size={14} className="text-vsc-text-dim" />
          </button>
          <button className="p-1 hover:bg-vsc-list-hover rounded" title="Clear Chat" onClick={handleClear}>
            <Trash2 size={14} className="text-vsc-text-dim" />
          </button>
        </div>
      </div>

      {/* Messages area (virtualized) */}
      <div className="flex-1 min-h-0">
        <Virtuoso
          data={chatMessages}
          followOutput="smooth"
          initialTopMostItemIndex={chatMessages.length > 0 ? chatMessages.length - 1 : 0}
          className="scrollbar-thin"
          components={{
            Header: () => (
              <>
                {/* No model warning */}
                {!modelLoaded && connected && (
                  <div className="m-3 p-3 bg-vsc-sidebar rounded-lg border border-vsc-warning/20 text-vsc-sm">
                    <div className="text-vsc-warning font-medium mb-1">No model loaded</div>
                    <div className="text-vsc-text-dim text-vsc-xs">
                      Load a GGUF model from the Settings panel to start chatting.
                    </div>
                  </div>
                )}
                {!connected && (
                  <div className="m-3 p-3 bg-vsc-sidebar rounded-lg border border-vsc-error/20 text-vsc-sm">
                    <div className="text-vsc-error font-medium mb-1">Not connected</div>
                    <div className="text-vsc-text-dim text-vsc-xs">
                      Waiting for backend server connection...
                    </div>
                  </div>
                )}
                {/* Todo list */}
                {todos.length > 0 && (
                  <div className="mx-3 mt-2 p-2 bg-vsc-sidebar rounded-lg border border-vsc-panel-border/50 text-vsc-xs">
                    <div className="font-medium text-vsc-text mb-1">Task Progress</div>
                    {todos.map(todo => (
                      <div key={todo.id} className="flex items-center gap-1.5 py-0.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          todo.status === 'done' ? 'bg-vsc-success' :
                          todo.status === 'in-progress' ? 'bg-vsc-accent' : 'bg-vsc-text-dim'
                        }`} />
                        <span className={todo.status === 'done' ? 'line-through text-vsc-text-dim' : 'text-vsc-text'}>
                          {todo.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ),
            Footer: () => (
              <>
                {/* Streaming response */}
                {chatStreaming && (
                  <div className="chat-message assistant">
                    <div className="text-vsc-xs text-vsc-text-dim mb-1 font-medium uppercase tracking-wider flex items-center gap-2">
                      guIDE
                      {chatIteration && chatIteration.iteration > 1 && (
                        <span className="text-vsc-accent">Step {chatIteration.iteration}/{chatIteration.maxIterations}</span>
                      )}
                    </div>
                    {chatThinkingText && (
                      <div className="mb-2">
                        <button
                          className="flex items-center gap-1 text-vsc-xs text-vsc-text-dim hover:text-vsc-text"
                          onClick={() => setThinkingExpanded(!thinkingExpanded)}
                        >
                          {thinkingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <Brain size={12} />
                          <span>Thinking...</span>
                        </button>
                        {thinkingExpanded && (
                          <pre className="mt-1 p-2 bg-vsc-sidebar rounded text-vsc-xs text-vsc-text-dim overflow-auto max-h-[200px] whitespace-pre-wrap">
                            {chatThinkingText}
                          </pre>
                        )}
                      </div>
                    )}
                    {chatGeneratingTool && !chatGeneratingTool.done && (
                      <div className="flex items-center gap-2 mb-2 text-vsc-xs text-vsc-accent">
                        <Loader size={12} className="animate-spin" />
                        <span>Generating: {chatGeneratingTool.functionName}</span>
                      </div>
                    )}
                    {chatStreamingText && (
                      <>
                        <MarkdownRenderer content={chatStreamingText} streaming />
                        <span className="streaming-cursor" />
                      </>
                    )}
                    {streamingFileBlocks.map((block, i) => (
                      <FileContentBlock
                        key={`${block.filePath}-${i}`}
                        filePath={block.filePath}
                        language={block.language}
                        fileName={block.fileName}
                        content={block.content}
                        complete={block.complete}
                      />
                    ))}
                    {!chatStreamingText && !chatThinkingText && (
                      <div className="flex items-center gap-1 py-2">
                        <div className="w-1.5 h-1.5 bg-vsc-text-dim rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 bg-vsc-text-dim rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 bg-vsc-text-dim rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                )}
              </>
            ),
          }}
          itemContent={(idx, msg) => (
            <>
              {/* Checkpoint divider */}
              {idx > 0 && msg.role === 'user' && chatMessages[idx - 1]?.role === 'assistant' && (
                <div className="flex items-center gap-2 px-4 my-2">
                  <div className="flex-1 h-px bg-vsc-panel-border/30" />
                  <button
                    className="flex items-center gap-1 text-[9px] text-vsc-text-dim/50 hover:text-vsc-text-dim px-1.5 py-0.5 rounded hover:bg-vsc-list-hover/30 transition-colors"
                    title="Restore conversation to this point"
                    onClick={() => {/* stub */}}
                  >
                    <RotateCcw size={8} />
                    <Clock size={8} />
                    <span>
                      {chatMessages[idx - 1]?.timestamp
                        ? new Date(chatMessages[idx - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : `Turn ${Math.ceil(idx / 2)}`
                      }
                    </span>
                  </button>
                  <div className="flex-1 h-px bg-vsc-panel-border/30" />
                </div>
              )}
              {msg.role === 'system' ? (
                <div className="text-vsc-xs text-vsc-text-dim italic px-2 py-1 border-l-2 border-vsc-panel-border/50">
                  {msg.content}
                </div>
              ) : (
                <div className={`chat-message ${msg.role}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-vsc-xs font-medium uppercase tracking-wider text-vsc-text-dim">
                      {msg.role === 'user' ? 'You' : 'guIDE'}
                    </span>
                    {msg.timestamp && (
                      <span className="text-[10px] text-vsc-text-dim/50">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  {msg.role === 'assistant' ? (
                    <>
                      {msg.toolCalls?.map((tc, i) => (
                        <ToolCallCard key={i} toolCall={tc} />
                      ))}
                      <MarkdownRenderer content={msg.content} />
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              )}
            </>
          )}
        />
      </div>

      {/* ─── Unified Input Container ──────────────────────── */}
      <div className="flex-shrink-0 p-2 relative">
        <div className="rounded-xl border border-vsc-panel-border/60 bg-vsc-sidebar overflow-visible">

          {/* Todo list progress (collapsible) */}
          {todos.length > 0 && <TodoDropdown todos={todos} />}

          {/* Context indicator badges */}
          {(() => {
            const activeFile = openTabs.find(t => t.id === activeTabId);
            return (activeFile || editorSelection) ? (
              <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
                {activeFile && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-vsc-accent/10 text-vsc-accent text-[10px] rounded-md">
                    <FileCode size={10} />
                    {activeFile.name}
                  </span>
                )}
                {editorSelection && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-vsc-warning/10 text-vsc-warning text-[10px] rounded-md">
                    {editorSelection.chars} chars ({editorSelection.lines} {editorSelection.lines === 1 ? 'line' : 'lines'}) selected
                  </span>
                )}
              </div>
            ) : null;
          })()}

          {/* Files changed by AI */}
          {chatFilesChanged.length > 0 && (
            <div className="border-b border-vsc-panel-border/30">
              <div className="flex items-center gap-1 px-3 pt-1.5 pb-1">
                <button
                  className="flex items-center gap-1 text-[10px] text-vsc-text-dim hover:text-vsc-text"
                  onClick={() => setFilesChangedExpanded(!filesChangedExpanded)}
                >
                  {filesChangedExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <span className="font-medium">Files Changed</span>
                  <span className="text-vsc-text-dim/70">({chatFilesChanged.length})</span>
                </button>
                <div className="flex-1" />
                <button
                  className="p-0.5 hover:bg-vsc-success/10 rounded text-vsc-success"
                  title="Keep all changes"
                  onClick={() => {/* stub — would apply all diffs */}}
                >
                  <Check size={11} />
                </button>
                <button
                  className="p-0.5 hover:bg-vsc-error/10 rounded text-vsc-error"
                  title="Undo all changes"
                  onClick={() => setChatFilesChanged([])}
                >
                  <Undo2 size={11} />
                </button>
              </div>
              {filesChangedExpanded && (
                <div className="px-3 pb-1.5 flex flex-col gap-0.5 max-h-[100px] overflow-y-auto scrollbar-thin">
                  {chatFilesChanged.map(f => (
                    <div key={f.path} className="flex items-center gap-1 text-[10px] rounded px-1 py-0.5 hover:bg-vsc-list-hover/50 group">
                      <span className="text-vsc-text truncate flex-1">{f.name}</span>
                      {(f.linesAdded > 0) && <span className="text-vsc-success">+{f.linesAdded}</span>}
                      {(f.linesRemoved > 0) && <span className="text-vsc-error">-{f.linesRemoved}</span>}
                      <button
                        className="p-0.5 hover:bg-vsc-success/10 rounded text-vsc-success opacity-0 group-hover:opacity-100"
                        title="Keep this file's changes"
                        onClick={() => {/* stub */}}
                      >
                        <Check size={9} />
                      </button>
                      <button
                        className="p-0.5 hover:bg-vsc-error/10 rounded text-vsc-error opacity-0 group-hover:opacity-100"
                        title="Undo this file's changes"
                        onClick={() => setChatFilesChanged(chatFilesChanged.filter(cf => cf.path !== f.path))}
                      >
                        <Undo2 size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!filesChangedExpanded && (
                <div className="flex items-center gap-1 px-3 pb-1 overflow-x-auto scrollbar-none">
                  {chatFilesChanged.map(f => (
                    <span key={f.path} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-vsc-panel-border/20 text-[10px] rounded-md flex-shrink-0">
                      <span className="text-vsc-text truncate max-w-[100px]">{f.name}</span>
                      {(f.linesAdded > 0) && <span className="text-vsc-success">+{f.linesAdded}</span>}
                      {(f.linesRemoved > 0) && <span className="text-vsc-error">-{f.linesRemoved}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attachment previews */}
          {chatAttachments.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 overflow-x-auto scrollbar-none">
              {chatAttachments.map(a => (
                <div key={a.id} className="relative group flex-shrink-0">
                  {a.type.startsWith('image/') ? (
                    <img
                      src={a.url}
                      alt={a.name}
                      className="h-12 w-12 object-cover rounded-md border border-vsc-panel-border/40"
                    />
                  ) : (
                    <div className="h-12 px-2 flex items-center gap-1 bg-vsc-panel-border/20 rounded-md border border-vsc-panel-border/40">
                      <FileCode size={12} className="text-vsc-text-dim flex-shrink-0" />
                      <span className="text-[10px] text-vsc-text truncate max-w-[80px]">{a.name}</span>
                    </div>
                  )}
                  <button
                    className="absolute -top-1 -right-1 w-4 h-4 bg-vsc-error rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removeChatAttachment(a.id)}
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Message queue */}
          {messageQueue.length > 0 && (
            <div className="border-b border-vsc-panel-border/30 px-3 py-1.5">
              <div className="text-[10px] font-medium text-vsc-text-dim mb-1">Queue ({messageQueue.length})</div>
              <div className="flex flex-col gap-1 max-h-[80px] overflow-y-auto scrollbar-thin">
                {messageQueue.map((msg, i) => (
                  <div key={msg.id} className="flex items-center gap-1 group">
                    <span className="text-[9px] text-vsc-text-dim/60 w-3 text-right flex-shrink-0">{i + 1}</span>
                    <input
                      className="flex-1 text-[10px] bg-transparent border-none outline-none text-vsc-text px-1 py-0.5 rounded hover:bg-vsc-list-hover/30 focus:bg-vsc-list-hover/50"
                      value={msg.text}
                      onChange={(e) => updateQueuedMessage(msg.id, e.target.value)}
                    />
                    <button
                      className="p-0.5 text-vsc-text-dim hover:text-vsc-error opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeQueuedMessage(msg.id)}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Textarea */}
          <div
            className={`px-3 pt-2 pb-1 ${dragOver ? 'bg-vsc-accent/5 ring-1 ring-vsc-accent/30 ring-inset' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent border-none outline-none text-vsc-base text-vsc-text resize-none placeholder:text-vsc-text-dim"
              placeholder={chatStreaming ? 'guIDE is thinking...' : (modelLoaded ? 'Ask guIDE anything...' : 'Load a model to start...')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={!connected || chatStreaming}
              rows={1}
              style={{ minHeight: '28px', maxHeight: '200px' }}
            />
          </div>

          {/* Bottom Toolbar */}
          <div className="flex items-center px-2 pb-1.5 pt-0.5 gap-1">
            {/* Attach */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.txt,.md,.js,.jsx,.ts,.tsx,.py,.json,.yaml,.yml,.html,.css,.rs,.go,.java"
              onChange={(e) => { handleFileAttach(Array.from(e.target.files)); e.target.value = ''; }}
            />
            <button
              className="p-1.5 hover:bg-vsc-list-hover rounded-md transition-colors text-vsc-text-dim hover:text-vsc-text"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={14} />
            </button>

            {/* Mic */}
            <button
              className="p-1.5 hover:bg-vsc-list-hover rounded-md transition-colors text-vsc-text-dim hover:text-vsc-text"
              title="Voice input"
            >
              <Mic size={14} />
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-vsc-panel-border/50 mx-0.5" />

            {/* Auto mode toggle */}
            <button
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-vsc-xs font-medium transition-colors ${
                autoMode
                  ? 'bg-vsc-accent/15 text-vsc-accent'
                  : 'text-vsc-text-dim hover:bg-vsc-list-hover hover:text-vsc-text'
              }`}
              onClick={() => setAutoMode(!autoMode)}
              title="Auto mode — let guIDE execute tools automatically"
            >
              <Zap size={12} />
              <span>Auto</span>
            </button>

            {/* Plan mode toggle */}
            <button
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-vsc-xs font-medium transition-colors ${
                planMode
                  ? 'bg-purple-500/15 text-purple-400'
                  : 'text-vsc-text-dim hover:bg-vsc-list-hover hover:text-vsc-text'
              }`}
              onClick={() => setPlanMode(!planMode)}
              title="Plan mode — create a plan before executing"
            >
              <FileCode size={12} />
              <span>Plan</span>
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-vsc-panel-border/50 mx-0.5" />

            {/* Model picker */}
            <div>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded-md text-vsc-xs text-vsc-text-dim hover:bg-vsc-list-hover hover:text-vsc-text transition-colors"
                onClick={() => setModelPickerOpen(!modelPickerOpen)}
                title="Select model"
              >
                {cloudProvider ? <Cloud size={12} className="text-vsc-accent" /> : <Cpu size={12} />}
                <span className="truncate max-w-[80px]">{modelDisplayName}</span>
                <ChevronUp size={10} className={`transition-transform ${modelPickerOpen ? '' : 'rotate-180'}`} />
              </button>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send / Stop */}
            {chatStreaming ? (
              <button
                className="p-1.5 bg-vsc-error/20 hover:bg-vsc-error/30 text-vsc-error rounded-lg transition-colors"
                onClick={handleStop}
                title="Stop generation"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="p-1.5 bg-vsc-accent hover:bg-vsc-accent-hover text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handleSend}
                disabled={!input.trim() || !connected}
                title="Send message"
              >
                <ArrowUp size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Model picker dropdown — positioned relative to outer container */}
        {modelPickerOpen && (
          <ModelPickerDropdown
            onClose={() => setModelPickerOpen(false)}
            models={availableModels}
            currentModel={modelInfo}
          />
        )}
      </div>
    </div>
  );
}

// ── Vision capability lookup ──────────────────────────────────────────────────
const VISION_MODEL_SUBSTRINGS = {
  openai:     ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  anthropic:  ['claude-sonnet-4', 'claude-3-5-sonnet', 'claude-3-haiku'],
  google:     ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-3'],
  xai:        ['grok-3', 'grok-3-mini'],
  openrouter: ['gemini', 'gpt-4o', 'claude-3', 'pixtral', 'llava', 'vision', 'multimodal'],
  mistral:    ['pixtral'],
};

function isVisionModel(provider, modelId) {
  const substrings = VISION_MODEL_SUBSTRINGS[provider];
  if (!substrings) return false;
  const lower = (modelId || '').toLowerCase();
  return substrings.some(s => lower.includes(s.toLowerCase()));
}

// ── Provider metadata for display & signup URLs ──────────────────────────────
const PROVIDER_INFO = {
  groq:       { signupUrl: 'https://console.groq.com/keys', free: true, placeholder: 'gsk_...', note: 'Ultra-fast, 1000 RPM, best free tier' },
  cerebras:   { signupUrl: 'https://cloud.cerebras.ai/', free: true, placeholder: 'csk-...', note: 'Ultra-fast, 7-key rotation built-in' },
  google:     { signupUrl: 'https://aistudio.google.com/apikey', free: true, placeholder: 'AIza...', note: '1M context, 15 RPM' },
  sambanova:  { signupUrl: 'https://cloud.sambanova.ai/apis', free: true, placeholder: 'aaede...', note: 'Free inference (limited daily quota)' },
  openrouter: { signupUrl: 'https://openrouter.ai/keys', free: true, placeholder: 'sk-or-...', note: '100+ free models' },
  apifreellm: { signupUrl: 'https://apifreellm.com', free: true, placeholder: 'apf_...', note: 'Free API access' },
  nvidia:     { signupUrl: 'https://build.nvidia.com/explore', free: true, placeholder: 'nvapi-...', note: 'Free NIM inference' },
  cohere:     { signupUrl: 'https://dashboard.cohere.com/api-keys', free: true, placeholder: 'trial key...', note: '1000 calls/mo, no CC' },
  mistral:    { signupUrl: 'https://console.mistral.ai/api-keys', free: true, placeholder: 'key...', note: 'Free tier, rate limited' },
  huggingface:{ signupUrl: 'https://huggingface.co/settings/tokens', free: true, placeholder: 'hf_...', note: 'Free inference API' },
  cloudflare: { signupUrl: 'https://dash.cloudflare.com/', free: true, placeholder: 'accountId:apiToken', note: '10K neurons/day free' },
  together:   { signupUrl: 'https://api.together.xyz/settings/api-keys', free: false, placeholder: '...' },
  fireworks:  { signupUrl: 'https://fireworks.ai/account/api-keys', free: false, placeholder: '...' },
  openai:     { signupUrl: 'https://platform.openai.com/api-keys', free: false, placeholder: 'sk-...' },
  anthropic:  { signupUrl: 'https://console.anthropic.com/settings/keys', free: false, placeholder: 'sk-ant-...' },
  xai:        { signupUrl: 'https://console.x.ai/', free: false, placeholder: 'xai-...' },
  perplexity: { signupUrl: 'https://www.perplexity.ai/settings/api', free: false, placeholder: 'pplx-...', note: 'Web-search grounded responses' },
  deepseek:   { signupUrl: 'https://platform.deepseek.com/api_keys', free: false, placeholder: 'sk-...', note: 'V3 + R1 reasoning' },
  ai21:       { signupUrl: 'https://studio.ai21.com/account/api-key', free: false, placeholder: 'key...', note: 'Jamba 256K context' },
  deepinfra:  { signupUrl: 'https://deepinfra.com/dash/api_keys', free: false, placeholder: 'key...', note: 'Pay-per-use, cheap inference' },
  hyperbolic: { signupUrl: 'https://app.hyperbolic.xyz/settings', free: false, placeholder: 'key...' },
  novita:     { signupUrl: 'https://novita.ai/settings/key-management', free: false, placeholder: 'key...' },
  moonshot:   { signupUrl: 'https://platform.moonshot.cn/console/api-keys', free: false, placeholder: 'key...', note: 'Kimi K2 agentic model' },
  upstage:    { signupUrl: 'https://console.upstage.ai/api-keys', free: false, placeholder: 'up-...' },
  lepton:     { signupUrl: 'https://dashboard.lepton.ai/', free: false, placeholder: 'key...' },
};

function ModelPickerDropdown({ onClose, models, currentModel }) {
  const addNotification = useAppStore(s => s.addNotification);
  const modelLoading = useAppStore(s => s.modelLoading);
  const modelLoadProgress = useAppStore(s => s.modelLoadProgress);
  const favoriteModels = useAppStore(s => s.favoriteModels);
  const toggleFavoriteModel = useAppStore(s => s.toggleFavoriteModel);
  const cloudProvider = useAppStore(s => s.cloudProvider);
  const cloudModel = useAppStore(s => s.cloudModel);
  const setCloudProvider = useAppStore(s => s.setCloudProvider);
  const setCloudModel = useAppStore(s => s.setCloudModel);

  const [searchFilter, setSearchFilter] = useState('');
  const [expandedProviders, setExpandedProviders] = useState({});
  const [inlineKeyValues, setInlineKeyValues] = useState({});
  const [inlineKeyStatus, setInlineKeyStatus] = useState({}); // 'saved' | 'error'
  const [keyTestBusy, setKeyTestBusy] = useState({});
  const [providerTestStatus, setProviderTestStatus] = useState({}); // 'ok' | 'fail'
  const [openRouterModels, setOpenRouterModels] = useState(null);
  const [openRouterSearch, setOpenRouterSearch] = useState('');
  const [showCloudProviders, setShowCloudProviders] = useState(false);
  const [showFreeProviders, setShowFreeProviders] = useState(true);
  const [showPremiumProviders, setShowPremiumProviders] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);
  const [showOtherModels, setShowOtherModels] = useState(false);
  const [recommendedModels, setRecommendedModels] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(new Map());
  const [allProviders, setAllProviders] = useState([]);

  // Fetch all provider key status on mount
  useEffect(() => {
    fetch('/api/cloud/providers').then(r => r.json()).then(d => {
      setAllProviders(d.all || []);
    }).catch(() => {});
  }, []);

  // Fetch recommended models when section opened
  useEffect(() => {
    if (showRecommended && !recommendedModels) {
      fetch('/api/models/recommend').then(r => r.json()).then(d => {
        setRecommendedModels(d);
      }).catch(() => {});
    }
  }, [showRecommended, recommendedModels]);

  const toggleProvider = (provider) => {
    setExpandedProviders(prev => ({ ...prev, [provider]: !prev[provider] }));
    // Fetch OpenRouter catalog on first expand
    if (provider === 'openrouter' && !openRouterModels) {
      fetch('/api/cloud/models/openrouter').then(r => r.json()).then(d => {
        setOpenRouterModels(d.models || []);
      }).catch(() => {});
    }
  };

  const saveInlineKey = async (provider) => {
    const key = (inlineKeyValues[provider] || '').trim();
    try {
      await fetch('/api/cloud/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      setInlineKeyStatus(prev => ({ ...prev, [provider]: key ? 'saved' : 'cleared' }));
      // Refresh provider list
      const r = await fetch('/api/cloud/providers');
      const d = await r.json();
      setAllProviders(d.all || []);
      setTimeout(() => setInlineKeyStatus(prev => ({ ...prev, [provider]: null })), 2000);
    } catch {
      setInlineKeyStatus(prev => ({ ...prev, [provider]: 'error' }));
    }
  };

  const testProviderKey = async (provider) => {
    setKeyTestBusy(prev => ({ ...prev, [provider]: true }));
    try {
      const r = await fetch(`/api/cloud/test/${encodeURIComponent(provider)}`);
      const d = await r.json();
      setProviderTestStatus(prev => ({ ...prev, [provider]: d.success ? 'ok' : 'fail' }));
    } catch {
      setProviderTestStatus(prev => ({ ...prev, [provider]: 'fail' }));
    } finally {
      setKeyTestBusy(prev => ({ ...prev, [provider]: false }));
      setTimeout(() => setProviderTestStatus(prev => ({ ...prev, [provider]: null })), 3000);
    }
  };

  const disconnectProvider = async (provider) => {
    await fetch('/api/cloud/apikey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key: '' }),
    });
    setInlineKeyValues(prev => ({ ...prev, [provider]: '' }));
    const r = await fetch('/api/cloud/providers');
    const d = await r.json();
    setAllProviders(d.all || []);
    if (cloudProvider === provider) {
      setCloudProvider(null);
      setCloudModel(null);
    }
  };

  const selectCloudModel = (provider, modelId) => {
    setCloudProvider(provider);
    setCloudModel(modelId);
    fetch('/api/cloud/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model: modelId }),
    }).catch(() => {});
    onClose();
  };

  const isUsingCloud = !!cloudProvider;

  // Local models
  const llmModels = (models || []).filter(m => m.modelType === 'llm' || !m.modelType);
  const diffusionModels = (models || []).filter(m => m.modelType === 'diffusion');
  const filtered = searchFilter
    ? llmModels.filter(m =>
        (m.name || '').toLowerCase().includes(searchFilter.toLowerCase()) ||
        (m.family || '').toLowerCase().includes(searchFilter.toLowerCase())
      )
    : llmModels;

  const sorted = [...filtered].sort((a, b) => {
    const aFav = favoriteModels.includes(a.path);
    const bFav = favoriteModels.includes(b.path);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return 0;
  });

  const loadModel = (modelPath) => {
    setCloudProvider(null);
    setCloudModel(null);
    fetch('/api/models/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath }),
    }).then(r => r.json()).then(d => {
      if (!d.success) addNotification({ type: 'error', message: d.error });
    }).catch(e => addNotification({ type: 'error', message: e.message }));
    onClose();
  };

  const unloadModel = () => {
    fetch('/api/models/unload', { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.success) addNotification({ type: 'info', message: 'Model unloaded' });
      })
      .catch(() => {});
    onClose();
  };

  // Get provider info helper
  const getProviderLabel = (provider) => {
    const labels = {
      graysoft: 'GraySoft Cloud', openai: 'OpenAI', anthropic: 'Anthropic',
      google: 'Google Gemini', xai: 'xAI Grok', openrouter: 'OpenRouter',
      groq: 'Groq', apifreellm: 'APIFreeLLM', cerebras: 'Cerebras',
      sambanova: 'SambaNova', together: 'Together AI', fireworks: 'Fireworks AI',
      nvidia: 'NVIDIA NIM', cohere: 'Cohere', mistral: 'Mistral AI',
      huggingface: 'Hugging Face', cloudflare: 'Cloudflare Workers AI',
      perplexity: 'Perplexity', deepseek: 'DeepSeek', ai21: 'AI21 Labs',
      deepinfra: 'DeepInfra', hyperbolic: 'Hyperbolic', novita: 'Novita AI',
      moonshot: 'Moonshot AI', upstage: 'Upstage', lepton: 'Lepton AI',
    };
    return labels[provider] || provider;
  };

  // Build favorites list (cloud + local)
  const cloudFavorites = favoriteModels
    .filter(f => f.startsWith('cloud:'))
    .map(f => {
      const [, provider, ...rest] = f.split(':');
      return { key: f, provider, modelId: rest.join(':') };
    });
  const localFavorites = sorted.filter(m => favoriteModels.includes(m.path));

  const freeProviders = Object.entries(PROVIDER_INFO).filter(([, v]) => v.free).map(([k]) => k);
  const premiumProviders = Object.entries(PROVIDER_INFO).filter(([, v]) => !v.free).map(([k]) => k);

  // Render a single provider section
  const renderProviderSection = (provider) => {
    const info = PROVIDER_INFO[provider];
    if (!info) return null;
    const provData = allProviders.find(p => p.provider === provider);
    const hasKey = provData?.hasKey || false;
    const isExpanded = expandedProviders[provider];
    const label = getProviderLabel(provider);

    return (
      <div key={provider} className="border-b border-vsc-panel-border/20">
        <button
          className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-vsc-list-hover/50 flex items-center gap-2 transition-colors"
          onClick={() => toggleProvider(provider)}
        >
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <Cloud size={11} className={hasKey ? 'text-vsc-success' : 'text-vsc-text-dim'} />
          <span className="flex-1 text-vsc-text">{label}</span>
          {hasKey && <span className="text-[9px] text-vsc-success px-1 py-0.5 bg-vsc-success/10 rounded">Connected</span>}
          {info.free && !hasKey && <span className="text-[9px] text-vsc-accent px-1 py-0.5 bg-vsc-accent/10 rounded">Free</span>}
        </button>

        {isExpanded && (
          <div className="px-2 pb-2 bg-vsc-bg/30">
            {/* Inline API key input */}
            <div className="flex items-center gap-1 mt-1">
              <Key size={10} className="text-vsc-text-dim flex-shrink-0" />
              <input
                type="password"
                className="flex-1 px-1.5 py-1 bg-vsc-input border border-vsc-panel-border/50 rounded text-[11px] text-vsc-text outline-none focus:border-vsc-accent/50"
                placeholder={info.placeholder}
                value={inlineKeyValues[provider] || ''}
                onChange={e => setInlineKeyValues(prev => ({ ...prev, [provider]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') saveInlineKey(provider); }}
              />
              <button
                className="px-1.5 py-1 text-[10px] bg-vsc-accent text-white rounded hover:bg-vsc-accent-hover transition-colors"
                onClick={() => saveInlineKey(provider)}
              >
                Save
              </button>
              {inlineKeyStatus[provider] === 'saved' && <Check size={12} className="text-vsc-success" />}
              {inlineKeyStatus[provider] === 'error' && <X size={12} className="text-vsc-error" />}
            </div>

            {/* Signup link */}
            <a
              href={info.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block mt-1 text-[10px] text-vsc-accent hover:underline"
            >
              Get {info.free ? 'free' : ''} API key &rarr;
            </a>

            {info.note && (
              <div className="mt-0.5 text-[10px] text-vsc-text-dim">{info.note}</div>
            )}

            {/* Test key button */}
            {hasKey && (
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  className="px-2 py-0.5 text-[10px] text-vsc-text-dim border border-vsc-panel-border/50 rounded hover:bg-vsc-list-hover transition-colors disabled:opacity-50"
                  onClick={() => testProviderKey(provider)}
                  disabled={keyTestBusy[provider]}
                >
                  {keyTestBusy[provider] ? <Loader size={10} className="animate-spin inline" /> : 'Test key'}
                </button>
                {providerTestStatus[provider] === 'ok' && <span className="text-[10px] text-vsc-success">Key works</span>}
                {providerTestStatus[provider] === 'fail' && <span className="text-[10px] text-vsc-error">Key failed</span>}
              </div>
            )}

            {/* Provider models */}
            {hasKey && provider === 'openrouter' ? (
              // OpenRouter special: live catalog
              <div className="mt-2">
                <input
                  type="text"
                  className="w-full px-1.5 py-1 bg-vsc-input border border-vsc-panel-border/50 rounded text-[10px] text-vsc-text outline-none focus:border-vsc-accent/50 mb-1"
                  placeholder="Search OpenRouter models..."
                  value={openRouterSearch}
                  onChange={e => setOpenRouterSearch(e.target.value)}
                />
                {openRouterModels ? (
                  <div className="max-h-[200px] overflow-y-auto scrollbar-thin">
                    {(() => {
                      const s = openRouterSearch.toLowerCase();
                      const filt = s ? openRouterModels.filter(m => (m.name || m.id || '').toLowerCase().includes(s)) : openRouterModels;
                      const freeModels = filt.filter(m => m.id?.includes(':free'));
                      const paidModels = filt.filter(m => !m.id?.includes(':free'));
                      return (
                        <>
                          {freeModels.length > 0 && (
                            <>
                              <div className="text-[9px] text-vsc-success uppercase tracking-wider px-1 py-0.5 font-medium">Free</div>
                              {freeModels.slice(0, 50).map(m => (
                                <button
                                  key={m.id}
                                  className={`w-full text-left px-1.5 py-1 text-[10px] hover:bg-vsc-list-hover rounded flex items-center gap-1.5 ${
                                    cloudProvider === 'openrouter' && cloudModel === m.id ? 'bg-vsc-list-active' : ''
                                  }`}
                                  onClick={() => selectCloudModel('openrouter', m.id)}
                                >
                                  <span className="truncate flex-1 text-vsc-text">{m.name || m.id}</span>
                                  {isVisionModel('openrouter', m.id) && <Eye size={9} className="text-vsc-accent flex-shrink-0" title="Vision" />}
                                  <button
                                    className="p-0.5 flex-shrink-0"
                                    onClick={e => { e.stopPropagation(); toggleFavoriteModel(`cloud:openrouter:${m.id}`); }}
                                  >
                                    <Star size={9} className={favoriteModels.includes(`cloud:openrouter:${m.id}`) ? 'text-yellow-400 fill-yellow-400' : 'text-vsc-text-dim/30'} />
                                  </button>
                                </button>
                              ))}
                            </>
                          )}
                          {paidModels.length > 0 && (
                            <>
                              <div className="text-[9px] text-vsc-text-dim uppercase tracking-wider px-1 py-0.5 mt-1 font-medium">Paid</div>
                              {paidModels.slice(0, 50).map(m => (
                                <button
                                  key={m.id}
                                  className={`w-full text-left px-1.5 py-1 text-[10px] hover:bg-vsc-list-hover rounded flex items-center gap-1.5 ${
                                    cloudProvider === 'openrouter' && cloudModel === m.id ? 'bg-vsc-list-active' : ''
                                  }`}
                                  onClick={() => selectCloudModel('openrouter', m.id)}
                                >
                                  <span className="truncate flex-1 text-vsc-text">{m.name || m.id}</span>
                                  {isVisionModel('openrouter', m.id) && <Eye size={9} className="text-vsc-accent flex-shrink-0" title="Vision" />}
                                  <button
                                    className="p-0.5 flex-shrink-0"
                                    onClick={e => { e.stopPropagation(); toggleFavoriteModel(`cloud:openrouter:${m.id}`); }}
                                  >
                                    <Star size={9} className={favoriteModels.includes(`cloud:openrouter:${m.id}`) ? 'text-yellow-400 fill-yellow-400' : 'text-vsc-text-dim/30'} />
                                  </button>
                                </button>
                              ))}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-[10px] text-vsc-text-dim py-2 flex items-center gap-1"><Loader size={10} className="animate-spin" /> Loading catalog...</div>
                )}
              </div>
            ) : hasKey ? (
              // Regular provider models
              <div className="mt-1.5 max-h-[150px] overflow-y-auto scrollbar-thin">
                {(() => {
                  // Fetch provider models from static data (same as server)
                  const provModels = allProviders.find(p => p.provider === provider);
                  return (
                    <ProviderModelList
                      provider={provider}
                      cloudProvider={cloudProvider}
                      cloudModel={cloudModel}
                      selectCloudModel={selectCloudModel}
                      favoriteModels={favoriteModels}
                      toggleFavoriteModel={toggleFavoriteModel}
                    />
                  );
                })()}
              </div>
            ) : null}

            {/* Disconnect */}
            {hasKey && (
              <button
                className="mt-1.5 text-[10px] text-vsc-error hover:underline"
                onClick={() => disconnectProvider(provider)}
              >
                Disconnect {label}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 right-0 mb-1 max-h-[500px] overflow-hidden z-50 bg-vsc-sidebar border border-vsc-panel-border rounded-lg shadow-xl glass-strong flex flex-col">
        {/* Search */}
        <div className="p-2 border-b border-vsc-panel-border/50">
          <div className="text-vsc-xs font-medium text-vsc-text-dim uppercase tracking-wider px-1 mb-1.5">Models</div>
          <input
            type="text"
            className="w-full px-2 py-1 bg-vsc-input border border-vsc-panel-border/50 rounded text-vsc-xs text-vsc-text outline-none focus:border-vsc-accent/50"
            placeholder="Search models..."
            value={searchFilter}
            onChange={e => setSearchFilter(e.target.value)}
            autoFocus
          />
        </div>

        {/* Loading indicator */}
        {modelLoading && (
          <div className="px-3 py-2 border-b border-vsc-panel-border/30 flex items-center gap-2 text-vsc-xs text-vsc-accent">
            <Loader size={12} className="animate-spin" />
            <span>Loading model... {modelLoadProgress > 0 ? `${modelLoadProgress}%` : ''}</span>
          </div>
        )}

        <div className="overflow-y-auto flex-1 scrollbar-thin">

          {/* ── Favorites ──────────────────────────────────────── */}
          {(cloudFavorites.length > 0 || localFavorites.length > 0) && (
            <div className="border-b border-vsc-panel-border/30">
              <div className="px-2 py-1 text-[10px] text-vsc-text-dim uppercase tracking-wider bg-vsc-sidebar/80 flex items-center gap-1">
                <Star size={10} className="text-yellow-400" /> Favorites
              </div>
              {cloudFavorites.map(({ key, provider, modelId }) => (
                <button
                  key={key}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-vsc-list-hover flex items-center gap-2 ${
                    cloudProvider === provider && cloudModel === modelId ? 'bg-vsc-list-active' : ''
                  }`}
                  onClick={() => selectCloudModel(provider, modelId)}
                >
                  <Cloud size={11} className="text-vsc-accent flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-vsc-text">{modelId}</div>
                    <div className="text-[10px] text-vsc-text-dim">{getProviderLabel(provider)}</div>
                  </div>
                  {isVisionModel(provider, modelId) && <Eye size={9} className="text-vsc-accent flex-shrink-0" />}
                  <button
                    className="p-0.5 flex-shrink-0"
                    onClick={e => { e.stopPropagation(); toggleFavoriteModel(key); }}
                  >
                    <Star size={10} className="text-yellow-400 fill-yellow-400" />
                  </button>
                </button>
              ))}
              {localFavorites.map(m => (
                <button
                  key={m.path}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-vsc-list-hover flex items-center gap-2 ${
                    !isUsingCloud && currentModel?.path === m.path ? 'bg-vsc-list-active' : ''
                  }`}
                  onClick={() => loadModel(m.path)}
                >
                  <Cpu size={11} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-vsc-text">{m.name}</div>
                    <div className="text-[10px] text-vsc-text-dim">{m.sizeFormatted}</div>
                  </div>
                  <button
                    className="p-0.5 flex-shrink-0"
                    onClick={e => { e.stopPropagation(); toggleFavoriteModel(m.path); }}
                  >
                    <Star size={10} className="text-yellow-400 fill-yellow-400" />
                  </button>
                </button>
              ))}
            </div>
          )}

          {/* ── Current model (unload option) ─────────────────── */}
          {currentModel && !isUsingCloud && (
            <div className="p-1 border-b border-vsc-panel-border/30">
              <div className="px-2 py-1.5 rounded-md bg-vsc-list-active">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-vsc-xs font-medium text-vsc-text-bright truncate">{currentModel.name}</div>
                    <div className="text-[10px] text-vsc-text-dim flex items-center gap-2 mt-0.5">
                      {currentModel.family && <span>{currentModel.family}</span>}
                      {currentModel.contextSize && <span>{currentModel.contextSize} ctx</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-vsc-success" title="Loaded" />
                    <button
                      className="px-1.5 py-0.5 text-[10px] text-vsc-text-dim hover:text-vsc-error hover:bg-vsc-error/10 rounded transition-colors"
                      onClick={unloadModel}
                    >
                      Unload
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Cloud Providers ────────────────────────────────── */}
          <div className="border-b border-vsc-panel-border/30">
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-vsc-text-dim uppercase tracking-wider bg-vsc-sidebar/80 hover:bg-vsc-list-hover/30 transition-colors"
              onClick={() => setShowCloudProviders(!showCloudProviders)}
            >
              {showCloudProviders ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <Cloud size={10} /> Cloud Providers
              <span className="text-vsc-text-dim/60 ml-auto">{allProviders.filter(p => p.hasKey).length} connected</span>
            </button>

            {showCloudProviders && (
              <div>
                {/* guIDE Cloud AI — bundled entry */}
                <button
                  className={`w-full text-left px-2 py-2 text-[11px] hover:bg-vsc-list-hover flex items-center gap-2 border-b border-vsc-panel-border/20 ${
                    cloudProvider === 'graysoft' ? 'bg-vsc-list-active' : ''
                  }`}
                  onClick={() => selectCloudModel('graysoft', 'graysoft-cloud')}
                >
                  <Sparkles size={12} className="text-vsc-accent flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-vsc-text font-medium">guIDE Cloud AI</div>
                    <div className="text-[10px] text-vsc-text-dim">Auto-routes to fastest free provider</div>
                  </div>
                  {cloudProvider === 'graysoft' && <Check size={12} className="text-vsc-accent flex-shrink-0" />}
                </button>

                {/* Add Your Own Key — Free */}
                <div>
                  <button
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-vsc-success hover:bg-vsc-list-hover/30 transition-colors"
                    onClick={() => setShowFreeProviders(!showFreeProviders)}
                  >
                    {showFreeProviders ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                    <Key size={9} />
                    <span className="font-medium">Add Your Own Key</span>
                    <span className="text-vsc-success/60">&mdash; Free</span>
                  </button>
                  {showFreeProviders && freeProviders.map(p => renderProviderSection(p))}
                </div>

                {/* Premium Providers */}
                <div>
                  <button
                    className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-vsc-text-dim hover:bg-vsc-list-hover/30 transition-colors"
                    onClick={() => setShowPremiumProviders(!showPremiumProviders)}
                  >
                    {showPremiumProviders ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                    <Key size={9} />
                    <span className="font-medium">Premium Providers</span>
                  </button>
                  {showPremiumProviders && premiumProviders.map(p => renderProviderSection(p))}
                </div>
              </div>
            )}
          </div>

          {/* ── Quick Add — Recommended Models ────────────────── */}
          <div className="border-b border-vsc-panel-border/30">
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-vsc-text-dim uppercase tracking-wider bg-vsc-sidebar/80 hover:bg-vsc-list-hover/30 transition-colors"
              onClick={() => setShowRecommended(!showRecommended)}
            >
              {showRecommended ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <FolderPlus size={10} /> Quick Add — Download Models
            </button>

            {showRecommended && (
              <div>
                {!recommendedModels ? (
                  <div className="px-3 py-2 text-[10px] text-vsc-text-dim flex items-center gap-1">
                    <Loader size={10} className="animate-spin" /> Detecting hardware...
                  </div>
                ) : (
                  <>
                    {recommendedModels.vramMB > 0 && (
                      <div className="px-2 py-1 text-[10px] text-vsc-text-dim border-b border-vsc-panel-border/20">
                        GPU VRAM: {Math.round(recommendedModels.vramMB / 1024 * 10) / 10}GB &mdash; models up to {recommendedModels.maxModelGB}GB
                      </div>
                    )}
                    {/* Fits in VRAM */}
                    {(recommendedModels.fits || []).map(m => {
                      const isAlreadyDownloaded = llmModels.some(am => am.fileName === m.file || (am.name || '').includes(m.file));
                      const dlProgress = downloadProgress.get(m.file);
                      return (
                        <div key={m.file} className="px-2 py-1.5 text-[11px] flex items-center gap-2 border-b border-vsc-panel-border/20 hover:bg-vsc-list-hover/30 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-vsc-text font-medium">{m.name}</span>
                              <span className="text-[9px] text-vsc-text-dim">{m.size}GB</span>
                              {m.tags?.map(t => (
                                <span key={t} className={`text-[8px] px-1 py-0.5 rounded ${
                                  t === 'coding' ? 'bg-vsc-accent/15 text-vsc-accent' :
                                  t === 'reasoning' ? 'bg-purple-500/15 text-purple-400' :
                                  'bg-vsc-panel-border/30 text-vsc-text-dim'
                                }`}>{t}</span>
                              ))}
                            </div>
                            <div className="text-[10px] text-vsc-text-dim">{m.desc}</div>
                            {dlProgress && (
                              <div className="mt-1 flex items-center gap-1.5">
                                <div className="flex-1 h-1 bg-vsc-panel-border/30 rounded-full overflow-hidden">
                                  <div className="h-full bg-vsc-accent rounded-full transition-all duration-300" style={{ width: `${dlProgress.progress}%` }} />
                                </div>
                                <span className="text-[9px] text-vsc-text-dim whitespace-nowrap">{dlProgress.downloadedMB}/{dlProgress.totalMB}MB</span>
                                <button
                                  className="text-[9px] text-vsc-error hover:text-vsc-error"
                                  onClick={() => {
                                    fetch('/api/models/hf/cancel', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: m.file }),
                                    });
                                    setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                                  }}
                                  title="Cancel download"
                                >
                                  <X size={9} />
                                </button>
                              </div>
                            )}
                          </div>
                          {isAlreadyDownloaded ? (
                            <span className="text-[9px] text-vsc-success flex-shrink-0 flex items-center gap-0.5">
                              <Check size={10} /> Installed
                            </span>
                          ) : dlProgress ? (
                            <span className="text-[10px] text-vsc-accent flex-shrink-0">{dlProgress.progress}%</span>
                          ) : (
                            <button
                              className="p-1 bg-vsc-accent text-white rounded hover:bg-vsc-accent-hover flex-shrink-0 transition-colors"
                              onClick={async () => {
                                setDownloadProgress(prev => {
                                  const next = new Map(prev);
                                  next.set(m.file, { progress: 0, downloadedMB: '0', totalMB: String(Math.round(m.size * 1024)) });
                                  return next;
                                });
                                try {
                                  const result = await fetch('/api/models/hf/download', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ url: m.downloadUrl, fileName: m.file }),
                                  }).then(r => r.json());
                                  if (result.alreadyExists) {
                                    setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                                  } else if (!result.success) {
                                    addNotification({ type: 'error', message: result.error || 'Download failed' });
                                    setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                                  }
                                } catch (e) {
                                  addNotification({ type: 'error', message: e.message });
                                  setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                                }
                              }}
                              title={`Download ${m.name} (${m.size}GB)`}
                            >
                              <FolderPlus size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {/* Other models — may exceed VRAM */}
                    {(recommendedModels.other || []).length > 0 && (
                      <>
                        <button
                          className="w-full px-2 py-1 text-[10px] text-vsc-text-dim bg-vsc-bg/30 hover:text-vsc-text flex items-center gap-1"
                          onClick={() => setShowOtherModels(!showOtherModels)}
                        >
                          {showOtherModels ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                          Other Models ({recommendedModels.other.length}) &mdash; may exceed {recommendedModels.maxModelGB}GB limit
                        </button>
                        {showOtherModels && (recommendedModels.other || []).map(m => {
                          const isAlreadyDownloaded = llmModels.some(am => am.fileName === m.file || (am.name || '').includes(m.file));
                          const dlProgress = downloadProgress.get(m.file);
                          return (
                            <div key={m.file} className="px-2 py-1 text-[11px] flex items-center gap-2 border-b border-vsc-panel-border/20 opacity-60 hover:opacity-100 hover:bg-vsc-list-hover/30 transition-all">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="text-vsc-text">{m.name}</span>
                                  <span className="text-[9px] text-vsc-error">{m.size}GB</span>
                                </div>
                                <div className="text-[10px] text-vsc-text-dim">{m.desc}</div>
                                {dlProgress && (
                                  <div className="mt-0.5 flex items-center gap-1.5">
                                    <div className="flex-1 h-1 bg-vsc-panel-border/30 rounded-full overflow-hidden">
                                      <div className="h-full bg-vsc-accent rounded-full transition-all duration-300" style={{ width: `${dlProgress.progress}%` }} />
                                    </div>
                                    <span className="text-[9px] text-vsc-text-dim">{dlProgress.downloadedMB}/{dlProgress.totalMB}MB</span>
                                    <button className="text-[9px] text-vsc-error" onClick={() => {
                                      fetch('/api/models/hf/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.file }) });
                                      setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; });
                                    }}><X size={9} /></button>
                                  </div>
                                )}
                              </div>
                              {isAlreadyDownloaded ? (
                                <span className="text-[9px] text-vsc-success flex-shrink-0 flex items-center gap-0.5"><Check size={10} /> Installed</span>
                              ) : dlProgress ? (
                                <span className="text-[10px] text-vsc-accent flex-shrink-0">{dlProgress.progress}%</span>
                              ) : (
                                <button
                                  className="p-1 bg-vsc-panel-border/30 text-vsc-text rounded hover:bg-vsc-panel-border/50 flex-shrink-0"
                                  onClick={async () => {
                                    setDownloadProgress(prev => { const next = new Map(prev); next.set(m.file, { progress: 0, downloadedMB: '0', totalMB: String(Math.round(m.size * 1024)) }); return next; });
                                    try {
                                      const result = await fetch('/api/models/hf/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: m.downloadUrl, fileName: m.file }) }).then(r => r.json());
                                      if (result.alreadyExists) { setDownloadProgress(prev => { const next = new Map(prev); next.delete(m.file); return next; }); }
                                    } catch {}
                                  }}
                                  title={`Download ${m.name} (${m.size}GB) — may not fit`}
                                >
                                  <FolderPlus size={12} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Local LLM Models ──────────────────────────────── */}
          <div className="px-2 py-1 text-[10px] text-vsc-text-dim uppercase tracking-wider bg-vsc-sidebar/80 border-b border-vsc-panel-border/30 border-t flex items-center gap-1">
            <Cpu size={10} /> Local Models
          </div>
          {sorted.length === 0 ? (
            <div className="p-2 text-[11px] text-vsc-text-dim">
              No local models found. Add .gguf files below.
            </div>
          ) : (
            sorted.map(m => {
              const isCurrent = !isUsingCloud && currentModel?.path === m.path;
              const isFav = favoriteModels.includes(m.path);
              return (
                <button
                  key={m.path}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-vsc-list-hover flex items-center gap-2 ${
                    isCurrent ? 'bg-vsc-list-active' : ''
                  }`}
                  onClick={() => !isCurrent && loadModel(m.path)}
                >
                  <Cpu size={11} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-vsc-text">{m.name}</div>
                    <div className="text-[10px] text-vsc-text-dim">
                      {m.sizeFormatted}
                      {m.details?.quantization && <> &bull; {m.details.quantization}</>}
                      {m.details?.parameters && <> &bull; {m.details.parameters}</>}
                    </div>
                  </div>
                  <button
                    className="p-0.5 flex-shrink-0 hover:bg-vsc-list-hover rounded"
                    onClick={e => { e.stopPropagation(); toggleFavoriteModel(m.path); }}
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <Star size={10} className={isFav ? 'text-yellow-400 fill-yellow-400' : 'text-vsc-text-dim/30'} />
                  </button>
                  {isCurrent && <Check size={11} className="text-vsc-accent flex-shrink-0" />}
                </button>
              );
            })
          )}

          {/* ── Image Models (only if diffusion models exist) ── */}
          {diffusionModels.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] text-purple-400 uppercase tracking-wider bg-vsc-sidebar/80 border-b border-vsc-panel-border/30 border-t flex items-center gap-1">
                <ImageIcon size={10} /> Image Models
              </div>
              {diffusionModels.map(m => (
                <button
                  key={m.path}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-purple-900/20 flex items-center gap-2 ${
                    currentModel?.activeImageModelPath === m.path ? 'bg-purple-900/20' : ''
                  }`}
                  onClick={() => {
                    setCloudProvider(null);
                    setCloudModel(null);
                    // Switch image model via API
                    fetch('/api/models/load', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ modelPath: m.path }),
                    });
                    onClose();
                  }}
                >
                  <ImageIcon size={11} className="flex-shrink-0 text-purple-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-vsc-text">{m.name}</div>
                    <div className="text-[10px] text-vsc-text-dim">{m.sizeFormatted}{m.details?.quantization && <> &bull; {m.details.quantization}</>}</div>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Add Model Files + Rescan */}
          <button
            className="w-full text-left px-2 py-1.5 text-[11px] text-vsc-accent hover:bg-vsc-list-hover border-t border-vsc-panel-border/30 flex items-center gap-2"
            onClick={async () => {
              try {
                const result = await window.electronAPI?.modelsAdd();
                if (result?.success) onClose();
              } catch {
                // Not in Electron — show notification
                addNotification({ type: 'info', message: 'Add .gguf files to your models folder, then click Rescan.' });
              }
            }}
          >
            <FolderPlus size={11} />
            Add Model Files...
          </button>
          <button
            className="w-full text-left px-2 py-1.5 text-[11px] text-vsc-text-dim hover:bg-vsc-list-hover"
            onClick={async () => {
              try {
                await window.electronAPI?.modelsScan();
              } catch {
                await fetch('/api/models/scan', { method: 'POST' });
              }
              onClose();
            }}
          >
            &#x21BB; Rescan models
          </button>
        </div>
      </div>
    </>
  );
}

// Sub-component: renders model list for a specific cloud provider
function ProviderModelList({ provider, cloudProvider, cloudModel, selectCloudModel, favoriteModels, toggleFavoriteModel }) {
  const [models, setModels] = useState(null);

  useEffect(() => {
    fetch(`/api/cloud/models/${encodeURIComponent(provider)}`)
      .then(r => r.json())
      .then(d => setModels(d.models || []))
      .catch(() => setModels([]));
  }, [provider]);

  if (!models) {
    return <div className="text-[10px] text-vsc-text-dim py-1 flex items-center gap-1"><Loader size={10} className="animate-spin" /> Loading...</div>;
  }

  return models.map(m => (
    <button
      key={m.id}
      className={`w-full text-left px-1.5 py-1 text-[10px] hover:bg-vsc-list-hover rounded flex items-center gap-1.5 ${
        cloudProvider === provider && cloudModel === m.id ? 'bg-vsc-list-active' : ''
      }`}
      onClick={() => selectCloudModel(provider, m.id)}
    >
      <span className="truncate flex-1 text-vsc-text">{m.name || m.id}</span>
      {isVisionModel(provider, m.id) && <Eye size={9} className="text-vsc-accent flex-shrink-0" title="Vision" />}
      <button
        className="p-0.5 flex-shrink-0"
        onClick={e => { e.stopPropagation(); toggleFavoriteModel(`cloud:${provider}:${m.id}`); }}
      >
        <Star size={9} className={favoriteModels.includes(`cloud:${provider}:${m.id}`) ? 'text-yellow-400 fill-yellow-400' : 'text-vsc-text-dim/30'} />
      </button>
      {cloudProvider === provider && cloudModel === m.id && <Check size={10} className="text-vsc-accent flex-shrink-0" />}
    </button>
  ));
}

function TodoDropdown({ todos }) {
  const [expanded, setExpanded] = useState(false);
  const done = todos.filter(t => t.status === 'done').length;
  const inProgress = todos.filter(t => t.status === 'in-progress').length;
  const total = todos.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="border-b border-vsc-panel-border/30">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-vsc-text-dim hover:bg-vsc-list-hover/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="font-medium">Tasks</span>
        <span className="text-vsc-text-dim">{done}/{total}</span>
        <div className="flex-1 h-1 bg-vsc-panel-border/30 rounded-full overflow-hidden ml-1">
          <div
            className="h-full bg-vsc-accent rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-vsc-text-dim">{pct}%</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 max-h-[120px] overflow-y-auto scrollbar-thin">
          {todos.map(todo => (
            <div key={todo.id} className="flex items-center gap-1.5 py-0.5 text-[10px]">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                todo.status === 'done' ? 'bg-vsc-success' :
                todo.status === 'in-progress' ? 'bg-vsc-accent' : 'bg-vsc-text-dim/40'
              }`} />
              <span className={todo.status === 'done' ? 'line-through text-vsc-text-dim' : 'text-vsc-text'}>
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

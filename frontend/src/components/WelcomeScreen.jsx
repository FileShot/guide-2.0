/**
 * WelcomeScreen — Full-page overlay shown on app startup.
 * Displays: logo, Open Folder / New Project buttons, recent folders,
 * installed models with Use/Default/Active, Cloud AI card, keyboard shortcuts.
 * Dismissed when a project is opened or user clicks "Skip".
 */
import { useState, useEffect, useCallback } from 'react';
import useAppStore from '../stores/appStore';
import ModelDownloadPanel from './ModelDownloadPanel';
import {
  FolderOpen, Plus, Clock, ChevronRight, Package, Cloud,
  Star, Loader2, Zap, Code2, Brain, Keyboard, ArrowRight, Download,
} from 'lucide-react';

export default function WelcomeScreen() {
  const showWelcomeScreen = useAppStore(s => s.showWelcomeScreen);
  const setShowWelcomeScreen = useAppStore(s => s.setShowWelcomeScreen);
  const recentFolders = useAppStore(s => s.recentFolders);
  const setProjectPath = useAppStore(s => s.setProjectPath);
  const setFileTree = useAppStore(s => s.setFileTree);
  const setShowNewProjectDialog = useAppStore(s => s.setShowNewProjectDialog);
  const addNotification = useAppStore(s => s.addNotification);
  const availableModels = useAppStore(s => s.availableModels);
  const modelInfo = useAppStore(s => s.modelInfo);
  const modelLoading = useAppStore(s => s.modelLoading);
  const defaultModelPath = useAppStore(s => s.defaultModelPath);
  const setDefaultModelPath = useAppStore(s => s.setDefaultModelPath);

  const [loadingModel, setLoadingModel] = useState(null);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);

  if (!showWelcomeScreen) return null;

  // Show download panel as overlay
  if (showDownloadPanel) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-vsc-bg">
        <div className="w-full max-w-[500px] h-[80vh] bg-vsc-sidebar rounded-xl border border-vsc-panel-border shadow-2xl overflow-hidden">
          <ModelDownloadPanel onBack={() => setShowDownloadPanel(false)} />
        </div>
      </div>
    );
  }

  const openFolder = () => {
    // In Electron, use native dialog; in browser, use prompt
    if (window.electronAPI?.showOpenDialog) {
      window.electronAPI.showOpenDialog().then(result => {
        if (result) openProjectPath(result);
      });
    } else {
      const path = prompt('Enter folder path to open:');
      if (path) openProjectPath(path);
    }
  };

  const openProjectPath = (path) => {
    fetch('/api/project/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: path }),
    }).then(r => r.json()).then(d => {
      if (d.success) {
        setProjectPath(d.path);
        fetch(`/api/files/tree?path=${encodeURIComponent(d.path)}`)
          .then(r => r.json())
          .then(t => setFileTree(t.items || []))
          .catch(() => {});
      } else {
        addNotification({ type: 'error', message: d.error || 'Failed to open folder' });
      }
    }).catch(e => addNotification({ type: 'error', message: e.message }));
  };

  const openRecent = (path) => openProjectPath(path);

  const newProject = () => {
    setShowNewProjectDialog(true);
  };

  const loadModel = async (modelPath) => {
    setLoadingModel(modelPath);
    try {
      const r = await fetch('/api/models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath }),
      });
      const d = await r.json();
      if (!d.success) addNotification({ type: 'error', message: d.error });
    } catch (e) {
      addNotification({ type: 'error', message: e.message });
    }
    setLoadingModel(null);
  };

  const toggleDefault = (modelPath) => {
    setDefaultModelPath(defaultModelPath === modelPath ? null : modelPath);
  };

  const useCloudAI = () => {
    localStorage.setItem('guide-cloud-provider', 'groq');
    localStorage.setItem('guide-cloud-model', 'llama-3.3-70b-versatile');
    if (recentFolders.length > 0) {
      openRecent(recentFolders[0]);
    } else {
      setShowWelcomeScreen(false);
    }
  };

  const formatPath = (fullPath) => {
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    return {
      name: parts[parts.length - 1] || fullPath,
      parent: parts.slice(0, -1).join('/') || '/',
    };
  };

  const llmModels = (availableModels || []).filter(m =>
    m.modelType === 'llm' && !/mmproj/i.test(m.name || m.path || '')
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center overflow-auto bg-vsc-bg">
      {/* Skip button */}
      <button
        onClick={() => setShowWelcomeScreen(false)}
        className="absolute top-4 right-4 text-vsc-xs text-vsc-text-dim hover:text-vsc-text transition-colors px-3 py-1 rounded hover:bg-vsc-list-hover"
      >
        Skip
      </button>

      {/* Logo + Brand */}
      <div className="flex flex-col items-center mt-16 mb-8 select-none">
        <img
          src="/icon.ico"
          alt="guIDE"
          className="w-16 h-16 mb-4"
          style={{ filter: 'drop-shadow(0 0 20px rgb(var(--guide-accent) / 0.4))' }}
        />
        <h1 className="text-[32px] font-brand text-vsc-accent tracking-tight">
          guIDE
        </h1>
        <p className="text-vsc-xs text-vsc-text-dim mt-1">
          Local AI — No cloud required
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={openFolder}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium
            bg-vsc-accent text-vsc-bg hover:bg-vsc-accent-hover transition-all
            hover:-translate-y-0.5 active:translate-y-0"
        >
          <FolderOpen size={16} />
          Open Folder
        </button>
        <button
          onClick={newProject}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium
            bg-vsc-sidebar text-vsc-text border border-vsc-panel-border
            hover:border-vsc-accent hover:bg-vsc-list-hover transition-all
            hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {/* Two-column content */}
      <div className="w-full max-w-[860px] px-6 flex gap-8 min-h-0 pb-12">

        {/* Left Column — Recent Folders */}
        <div className="flex-1 min-w-0">
          {recentFolders.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mb-3 text-[11px] font-medium uppercase tracking-wider text-vsc-text-dim">
                <Clock size={12} />
                Recent
              </div>
              <div className="flex flex-col gap-1">
                {recentFolders.map(path => {
                  const { name, parent } = formatPath(path);
                  return (
                    <button
                      key={path}
                      onClick={() => openRecent(path)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                        transition-colors group bg-transparent border border-transparent
                        hover:bg-vsc-list-hover hover:border-vsc-panel-border"
                    >
                      <FolderOpen size={16} className="text-vsc-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-vsc-text truncate">{name}</div>
                        <div className="text-[11px] text-vsc-text-dim truncate">{parent}</div>
                      </div>
                      <ChevronRight size={14} className="text-vsc-text-dim flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <FolderOpen size={48} className="text-vsc-text-dim/30 mx-auto mb-4" />
              <p className="text-vsc-sm text-vsc-text-dim">No recent projects</p>
              <p className="text-vsc-xs text-vsc-text-dim/60 mt-1">Open a folder or create a new project to get started</p>
            </div>
          )}

          {/* Keyboard Shortcuts */}
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-3 text-[11px] font-medium uppercase tracking-wider text-vsc-text-dim">
              <Keyboard size={12} />
              Shortcuts
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-vsc-xs">
              {[
                ['Ctrl+Shift+P', 'Command Palette'],
                ['Ctrl+B', 'Toggle Sidebar'],
                ['Ctrl+L', 'Toggle AI Chat'],
                ['Ctrl+J', 'Toggle Terminal'],
                ['Ctrl+S', 'Save File'],
                ['Ctrl+P', 'Quick Open'],
              ].map(([key, action]) => (
                <div key={key} className="contents">
                  <kbd className="bg-vsc-badge px-1.5 py-0.5 rounded text-[10px] font-mono text-vsc-text-bright text-center">{key}</kbd>
                  <span className="text-vsc-text">{action}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column — Models */}
        <div className={recentFolders.length > 0 ? 'w-[310px] flex-shrink-0' : 'flex-1 min-w-0'}>
          {/* Cloud AI Card */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider text-vsc-text-dim">
              <Cloud size={12} />
              Cloud AI
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-vsc-sidebar border border-vsc-panel-border">
              <Cloud size={14} className="text-vsc-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-vsc-text">guIDE Cloud AI</div>
                <div className="text-[11px] text-vsc-text-dim">20 messages/day free</div>
              </div>
              <button
                onClick={useCloudAI}
                className="flex-shrink-0 text-[11px] px-3 py-1 rounded font-medium
                  bg-vsc-accent text-vsc-bg hover:bg-vsc-accent-hover transition-opacity"
              >
                Use
              </button>
            </div>
          </div>

          {/* Installed Models */}
          {llmModels.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider text-vsc-text-dim">
                <Package size={12} />
                Installed Models
                <button
                  onClick={() => setShowDownloadPanel(true)}
                  className="ml-auto flex items-center gap-1 text-[10px] text-vsc-accent hover:text-vsc-accent-hover transition-colors normal-case tracking-normal font-normal"
                >
                  <Download size={10} /> Download more
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {llmModels.map(model => {
                  const label = (model.name || '').replace(/\.gguf$/i, '');
                  const mp = model.path || model.name;
                  const isActive = modelInfo?.path === mp;
                  const isDefault = defaultModelPath === mp;
                  const isLoading = loadingModel === mp || (modelLoading && loadingModel === mp);

                  return (
                    <div
                      key={mp}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        isActive
                          ? 'bg-vsc-accent/10 border-vsc-accent'
                          : 'bg-vsc-sidebar border-vsc-panel-border'
                      }`}
                    >
                      {/* Default star */}
                      <button
                        onClick={() => toggleDefault(mp)}
                        className="flex-shrink-0 transition-colors"
                        title={isDefault ? 'Default model' : 'Set as default'}
                      >
                        <Star
                          size={13}
                          className={isDefault ? 'text-vsc-accent' : 'text-vsc-text-dim/40 hover:text-vsc-text-dim'}
                          fill={isDefault ? 'currentColor' : 'none'}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] text-vsc-text truncate block" title={label}>
                          {label}
                        </span>
                        {model.sizeFormatted && (
                          <span className="text-[10px] text-vsc-text-dim">{model.sizeFormatted}</span>
                        )}
                      </div>
                      <button
                        onClick={() => !isActive && loadModel(mp)}
                        disabled={isLoading || isActive}
                        className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded font-medium flex items-center gap-1 transition-opacity ${
                          isActive
                            ? 'bg-green-600/80 text-white cursor-default'
                            : 'bg-vsc-accent text-vsc-bg hover:bg-vsc-accent-hover cursor-pointer'
                        }`}
                        style={{ minWidth: 50, opacity: isLoading ? 0.7 : 1 }}
                      >
                        {isLoading ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : isActive ? (
                          'Active'
                        ) : (
                          'Use'
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No models found */}
          {llmModels.length === 0 && (
            <div className="text-center py-8">
              <Package size={36} className="text-vsc-text-dim/30 mx-auto mb-3" />
              <p className="text-vsc-sm text-vsc-text-dim">No models found</p>
              <p className="text-vsc-xs text-vsc-text-dim/60 mt-1">
                Place .gguf files in your models directory
              </p>
              <button
                onClick={() => setShowDownloadPanel(true)}
                className="mt-3 flex items-center gap-1.5 mx-auto px-4 py-2 text-[11px] font-medium rounded-lg bg-vsc-accent text-vsc-bg hover:bg-vsc-accent-hover transition-colors"
              >
                <Download size={12} /> Download from HuggingFace
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="pb-6 text-[10px] text-vsc-text-dim/40 select-none">
        guIDE 2.0 — Built for local AI inference
      </div>
    </div>
  );
}

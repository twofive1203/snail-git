import React, { useState } from 'react';
import { 
  GitMerge, 
  Check, 
  ArrowLeft, 
  ArrowRight, 
  Sparkles, 
  Save, 
  X,
  FileCode,
  ShieldCheck 
} from 'lucide-react';

interface ThreeWayMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath?: string;
  onResolved: () => void;
}

export const ThreeWayMergeModal: React.FC<ThreeWayMergeModalProps> = ({
  isOpen,
  onClose,
  filePath = 'src/auth/tokenManager.ts',
  onResolved,
}) => {
  if (!isOpen) return null;

  const [mergedContent, setMergedContent] = useState<string>(`export async function refreshJwtToken(token: string): Promise<TokenResult> {
  // 合并方案：同时保留本地性能监控指标与远程最新的重试安全机制
  const metrics = startMetricsTimer();
  const res = await fetchWithRetry('/api/auth/refresh', {
    headers: { 'Authorization': \`Bearer \${token}\` },
    timeout: 5000,
  });
  metrics.recordSuccess();
  return res.json();
}`);

  const leftYourVersion = `export async function refreshJwtToken(token: string): Promise<TokenResult> {
  // 本地修改：添加本地性能监控指标记录
  const metrics = startMetricsTimer();
  const res = await fetch('/api/auth/refresh', {
    headers: { 'Authorization': \`Bearer \${token}\` },
  });
  metrics.recordSuccess();
  return res.json();
}`;

  const rightTheirVersion = `export async function refreshJwtToken(token: string): Promise<TokenResult> {
  // 远程修改：接入重试机制与超时保护
  const res = await fetchWithRetry('/api/auth/refresh', {
    headers: { 'Authorization': \`Bearer \${token}\` },
    timeout: 5000,
  });
  return res.json();
}`;

  const handleApplyLeft = () => {
    setMergedContent(leftYourVersion);
  };

  const handleApplyRight = () => {
    setMergedContent(rightTheirVersion);
  };

  const handleApplySmart = () => {
    setMergedContent(`export async function refreshJwtToken(token: string): Promise<TokenResult> {
  // 智能合并结果：合并本地监控与远程安全重试策略
  const metrics = startMetricsTimer();
  const res = await fetchWithRetry('/api/auth/refresh', {
    headers: { 'Authorization': \`Bearer \${token}\` },
    timeout: 5000,
  });
  metrics.recordSuccess();
  return res.json();
}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none text-xs">
      <div className="w-[95vw] max-w-6xl h-[85vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题与合并动作 */}
        <div className="h-11 px-4 border-b border-jb-border flex items-center justify-between bg-jb-panel">
          <div className="flex items-center space-x-2">
            <GitMerge className="w-4 h-4 text-purple-400" />
            <span className="font-semibold text-sm text-jb-text-primary">Resolve Conflicts</span>
            <span className="text-jb-text-muted font-mono">({filePath})</span>
          </div>

          <div className="flex items-center space-x-2">
            {/* 一键智能合并 */}
            <button
              onClick={handleApplySmart}
              className="px-2.5 py-1.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-medium flex items-center space-x-1.5 transition-colors"
              title="自动应用所有无冲突变更"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-300" />
              <span>Apply All Non-Conflicting Changes</span>
            </button>

            <button
              onClick={() => {
                onResolved();
                onClose();
              }}
              className="px-3 py-1.5 rounded bg-jb-blue hover:bg-jb-blueHover text-white font-medium flex items-center space-x-1.5 transition-colors shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save and Mark Resolved</span>
            </button>

            <button 
              onClick={onClose}
              className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 三栏布局 */}
        <div className="flex-1 grid grid-cols-3 divide-x divide-jb-border overflow-hidden font-mono text-xs">
          {/* 左栏：Your Version */}
          <div className="flex flex-col bg-jb-bg/50 overflow-hidden">
            <div className="h-8 px-3 border-b border-jb-border bg-jb-panel/80 flex items-center justify-between font-sans">
              <span className="font-semibold text-jb-blue">Your Version (Local)</span>
              <button
                onClick={handleApplyLeft}
                className="px-2 py-0.5 rounded bg-jb-blue/20 hover:bg-jb-blue/30 text-jb-blue flex items-center space-x-1 text-[11px]"
              >
                <span>Accept Left</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <pre className="p-3 text-jb-text-code whitespace-pre-wrap overflow-y-auto flex-1 font-mono leading-relaxed bg-blue-950/10">
              {leftYourVersion}
            </pre>
          </div>

          {/* 中栏：Result 最终合并代码 */}
          <div className="flex flex-col bg-jb-bg overflow-hidden ring-1 ring-jb-border">
            <div className="h-8 px-3 border-b border-jb-border bg-jb-panel/90 flex items-center justify-between font-sans">
              <div className="flex items-center space-x-1.5 font-semibold text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Result (Merged Output)</span>
              </div>
              <span className="text-[10px] text-jb-text-muted">可直接编辑</span>
            </div>
            <textarea
              value={mergedContent}
              onChange={(e) => setMergedContent(e.target.value)}
              className="w-full flex-1 p-3 bg-jb-bg text-jb-text-primary font-mono text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-jb-blue/40"
            />
          </div>

          {/* 右栏：Their Version */}
          <div className="flex flex-col bg-jb-bg/50 overflow-hidden">
            <div className="h-8 px-3 border-b border-jb-border bg-jb-panel/80 flex items-center justify-between font-sans">
              <button
                onClick={handleApplyRight}
                className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 flex items-center space-x-1 text-[11px]"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>Accept Right</span>
              </button>
              <span className="font-semibold text-purple-400">Their Version (Incoming)</span>
            </div>
            <pre className="p-3 text-jb-text-code whitespace-pre-wrap overflow-y-auto flex-1 font-mono leading-relaxed bg-purple-950/10">
              {rightTheirVersion}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../services/gitService';

type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

function useMaximized() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let stop = false;
    let unlisten = () => {};
    const win = getCurrentWindow();
    void win.isMaximized().then(value => {
      if (!stop) setMaximized(value);
    }).catch(() => undefined);
    void win.onResized(() => {
      void win.isMaximized().then(value => {
        if (!stop) setMaximized(value);
      }).catch(() => undefined);
    }).then(fn => { unlisten = fn; }).catch(() => undefined);
    return () => {
      stop = true;
      unlisten();
    };
  }, []);

  return [maximized, setMaximized] as const;
}

async function runWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  const win = getCurrentWindow();
  if (action === 'minimize') await win.minimize();
  else if (action === 'toggleMaximize') await win.toggleMaximize();
  else await win.close();
}

function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" className="w-3 h-3" aria-hidden="true">
      <rect x="2.2" y="0.8" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.8" y="2.2" width="8" height="8" fill="#1E1F22" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Windows 风格标题栏按钮。无边框窗口下替代系统标题栏。 */
export const WindowControls: React.FC = () => {
  const [maximized, setMaximized] = useMaximized();
  if (!isTauriEnvironment()) return null;

  const buttonClass = 'w-[46px] h-11 flex items-center justify-center text-[#DFE1E5] hover:bg-white/10 transition-colors';

  return (
    <div className="flex items-stretch h-11 shrink-0" data-tauri-drag-region="false">
      <button
        type="button"
        title="最小化"
        className={buttonClass}
        onClick={() => { void runWindow('minimize').catch(() => undefined); }}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title={maximized ? '还原' : '最大化'}
        className={buttonClass}
        onClick={() => {
          void runWindow('toggleMaximize').then(async () => {
            setMaximized(await getCurrentWindow().isMaximized());
          }).catch(() => undefined);
        }}
      >
        {maximized ? <RestoreIcon /> : <Square className="w-3 h-3" />}
      </button>
      <button
        type="button"
        title="关闭"
        className={`${buttonClass} hover:bg-[#C42B1C] hover:text-white`}
        onClick={() => { void runWindow('close').catch(() => undefined); }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

const EDGES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'North', className: 'top-0 left-2 right-2 h-1.5 cursor-n-resize' },
  { direction: 'South', className: 'bottom-0 left-2 right-2 h-1.5 cursor-s-resize' },
  { direction: 'West', className: 'left-0 top-2 bottom-2 w-1.5 cursor-w-resize' },
  { direction: 'East', className: 'right-0 top-2 bottom-2 w-1.5 cursor-e-resize' },
  { direction: 'NorthWest', className: 'top-0 left-0 w-2 h-2 cursor-nw-resize' },
  { direction: 'NorthEast', className: 'top-0 right-0 w-2 h-2 cursor-ne-resize' },
  { direction: 'SouthWest', className: 'bottom-0 left-0 w-2 h-2 cursor-sw-resize' },
  { direction: 'SouthEast', className: 'bottom-0 right-0 w-2 h-2 cursor-se-resize' },
];

/** 去掉系统边框后，用细边恢复窗口缩放。最大化时不拦截点击。 */
export const WindowResizeFrame: React.FC = () => {
  const [maximized] = useMaximized();
  if (!isTauriEnvironment() || maximized) return null;

  const start = (direction: ResizeDirection) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction).catch(() => undefined);
  };

  return (
    <>
      {EDGES.map(edge => (
        <div
          key={edge.direction}
          data-tauri-drag-region="false"
          onMouseDown={start(edge.direction)}
          className={`fixed z-[70] ${edge.className}`}
        />
      ))}
    </>
  );
};

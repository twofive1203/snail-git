import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/react';

type Orientation = 'horizontal' | 'vertical';

interface SplitPaneProps {
  orientation: Orientation;
  /** 固定尺寸的一侧：start 为左/上，end 为右/下。 */
  sized: 'start' | 'end';
  defaultSize: number;
  /** 没有本地记录时按容器主轴比例取初始尺寸。0.5 表示一半。拖拽后改为记住像素。 */
  defaultRatio?: number;
  min: number;
  max: number;
  /** 另一侧至少保留的像素，避免把相邻区域拖没。 */
  minOther?: number;
  storageKey: string;
  className?: string;
  /** 传入后按该尺寸锁定，并隐藏分割条。折叠详情时使用。 */
  lockedSize?: number;
  start: React.ReactNode;
  end: React.ReactNode;
}

const HANDLE = 1;

function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  orientation,
  sized,
  defaultSize,
  defaultRatio,
  min,
  max,
  minOther = 160,
  storageKey,
  className = '',
  lockedSize,
  start,
  end,
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState<number | null>(() => readStored(storageKey));
  const [containerSpan, setContainerSpan] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointer: number; size: number } | null>(null);

  useEffect(() => {
    try {
      if (preferred == null) {
        if (defaultRatio == null) localStorage.setItem(storageKey, String(defaultSize));
        return;
      }
      localStorage.setItem(storageKey, String(preferred));
    } catch {
      /* 浏览器禁止本地存储时，尺寸只在当前会话有效 */
    }
  }, [preferred, storageKey, defaultSize, defaultRatio]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.round(orientation === 'horizontal' ? rect.width : rect.height);
      setContainerSpan(prev => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [orientation]);

  const fit = (value: number) => {
    const hardMax = containerSpan > HANDLE
      ? Math.max(min, containerSpan - minOther - HANDLE)
      : max;
    return Math.min(max, hardMax, Math.max(min, value));
  };

  const fallback = defaultRatio != null && containerSpan > HANDLE
    ? containerSpan * defaultRatio
    : defaultSize;

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (lockedSize != null || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointer: orientation === 'horizontal' ? event.clientX : event.clientY,
      size: fit(preferred ?? fallback),
    };
    setDragging(true);
    document.body.style.cursor = orientation === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const client = orientation === 'horizontal' ? event.clientX : event.clientY;
    const sign = sized === 'start' ? 1 : -1;
    setPreferred(fit(drag.size + (client - drag.pointer) * sign));
  };

  const shown = lockedSize ?? fit(preferred ?? fallback);
  const sizedStyle = orientation === 'horizontal' ? { width: shown } : { height: shown };
  // 只在交叉轴拉满。主轴用 flex-1 / 显式尺寸，避免 width/height:100% 把另一侧挤出容器。
  const paneClass = orientation === 'horizontal'
    ? 'h-full min-w-0 min-h-0 overflow-hidden flex flex-col'
    : 'w-full min-w-0 min-h-0 overflow-hidden flex flex-col';
  const horizontal = orientation === 'horizontal';
  const handle = lockedSize == null ? (
    <div className={`relative z-20 shrink-0 ${horizontal ? 'w-px' : 'h-px'} ${dragging ? 'bg-jb-blue' : 'bg-jb-border'}`}>
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(shown)}
        title={horizontal ? t('window.dragWidth') : t('window.dragHeight')}
        onPointerDown={startDrag}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={() => {
          if (defaultRatio != null) {
            setPreferred(null);
            try { localStorage.removeItem(storageKey); } catch { /* 恢复比例失败时仍按当前会话的一半显示 */ }
            return;
          }
          setPreferred(fit(defaultSize));
        }}
        className={`absolute touch-none select-none ${dragging ? 'bg-jb-blue/30' : 'hover:bg-jb-blue/30'} ${
          horizontal ? 'inset-y-0 -left-[3px] w-[7px] cursor-col-resize' : 'inset-x-0 -top-[3px] h-[7px] cursor-row-resize'
        }`}
      />
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`flex min-w-0 min-h-0 overflow-hidden ${orientation === 'horizontal' ? 'flex-row' : 'flex-col'} ${className}`}
    >
      <div className={sized === 'start' ? `${paneClass} shrink-0` : `${paneClass} flex-1`} style={sized === 'start' ? sizedStyle : undefined}>
        {start}
      </div>
      {handle}
      <div className={sized === 'end' ? `${paneClass} shrink-0` : `${paneClass} flex-1`} style={sized === 'end' ? sizedStyle : undefined}>
        {end}
      </div>
    </div>
  );
};

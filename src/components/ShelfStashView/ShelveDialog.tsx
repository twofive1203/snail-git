import React, { useEffect, useRef, useState } from 'react';
import { Archive } from 'lucide-react';

interface ShelveDialogProps {
  open: boolean;
  fileCount: number;
  hint: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/** 架藏命名弹窗。空名称会由后端回退为带时间的默认名。 */
export const ShelveDialog: React.FC<ShelveDialogProps> = ({
  open,
  fileCount,
  hint,
  onCancel,
  onConfirm,
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
      <form
        className="w-full max-w-md bg-[#1E1F22] border border-[#393B40] rounded-lg shadow-2xl p-4 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(name.trim());
        }}
      >
        <div className="flex items-center space-x-2 text-sm font-semibold text-[#DFE1E5]">
          <Archive className="w-4 h-4 text-amber-400" />
          <span>Shelve Changes</span>
        </div>
        <p className="mt-2 text-[#9DA0A8] leading-relaxed">{hint}</p>
        <label className="mt-3 block text-[11px] text-[#8C9099]">
          架藏名称
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={`Shelf · ${fileCount} files`}
            className="mt-1 w-full bg-[#2B2D30] border border-[#393B40] rounded px-2.5 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
          />
        </label>
        <div className="mt-4 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-[#393B40] text-[#DFE1E5] hover:bg-[#2B2D30]"
          >
            取消
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-[#3574F0] hover:bg-[#4682F7] text-white font-medium"
          >
            架藏
          </button>
        </div>
      </form>
    </div>
  );
};

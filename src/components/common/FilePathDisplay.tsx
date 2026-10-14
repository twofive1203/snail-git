import React from 'react';

interface FilePathDisplayProps {
  path: string;
  className?: string;
  filenameClassName?: string;
}

/** 目录可收缩，文件名始终完整，避免长包名截掉类名。 */
export const FilePathDisplay: React.FC<FilePathDisplayProps> = ({
  path,
  className = '',
  filenameClassName = '',
}) => {
  const normalized = path.replace(/\\/g, '/');
  const lastSlashIndex = normalized.lastIndexOf('/');
  const nameClass = filenameClassName || 'text-[#DFE1E5]';

  if (lastSlashIndex === -1) {
    return (
      <span
        title={normalized}
        className={`font-mono text-xs font-medium shrink-0 ${nameClass} ${className}`}
      >
        {normalized}
      </span>
    );
  }

  const dir = normalized.substring(0, lastSlashIndex + 1);
  const filename = normalized.substring(lastSlashIndex + 1);

  return (
    <div className={`flex items-center min-w-0 font-mono text-xs ${className}`} title={normalized}>
      <span className="text-[#8C9099] truncate shrink min-w-0">{dir}</span>
      <span className={`font-medium shrink-0 group-hover:text-white transition-colors ${nameClass}`}>
        {filename}
      </span>
    </div>
  );
};

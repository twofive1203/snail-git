import { useEffect, useState } from 'react';
import { settleConfirm, subscribeConfirm, type AskConfirmOptions } from './askConfirm';
import { ConfirmDialog } from './ConfirmDialog';

/** 全局只挂一份。各处用 askConfirm() 排队弹出，避免再走浏览器默认确认框。 */
export function ConfirmHost() {
  const [current, setCurrent] = useState<AskConfirmOptions | null>(null);

  useEffect(() => subscribeConfirm(setCurrent), []);

  return (
    <ConfirmDialog
      open={current !== null}
      title={current?.title ?? ''}
      message={current?.message ?? ''}
      files={current?.files}
      actions={current ? [{
        value: 'ok',
        label: current.confirmLabel,
        tone: current.tone ?? 'default',
      }] : []}
      onChoose={() => settleConfirm(true)}
      onCancel={() => settleConfirm(false)}
    />
  );
}

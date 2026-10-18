import { useEffect, useState } from 'react';
import { settleConfirm, settleInput, subscribeDialog, type DialogRequest } from './dialogQueue';
import { ConfirmDialog } from './ConfirmDialog';
import { InputDialog } from './InputDialog';

/**
 * 全局只挂一份，同时承载确认框与输入框。
 * 两者共用一条队列，所以不会同时出现两个弹窗。
 */
export function ConfirmHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);

  useEffect(() => subscribeDialog(setCurrent), []);

  const confirm = current?.kind === 'confirm' ? current : null;
  const input = current?.kind === 'input' ? current : null;

  return (
    <>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        files={confirm?.files}
        actions={confirm ? [{
          value: 'ok',
          label: confirm.confirmLabel,
          tone: confirm.tone ?? 'default',
        }] : []}
        onChoose={() => settleConfirm(true)}
        onCancel={() => settleConfirm(false)}
      />
      <InputDialog
        open={input !== null}
        options={input}
        onSubmit={(value) => settleInput(value)}
        onCancel={() => settleInput(null)}
      />
    </>
  );
}

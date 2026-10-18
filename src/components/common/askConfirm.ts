import { isDialogOpen, pushDialog, type AskConfirmOptions } from './dialogQueue';

export type { AskConfirmOptions };

/** 任一弹窗（确认或输入）打开中。全局快捷键用它拦截。 */
export function isAskConfirmOpen() {
  return isDialogOpen();
}

/** 项目风格的二次确认，替代 window.confirm。取消、Esc、点遮罩都解析为 false。 */
export function askConfirm(options: AskConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pushDialog({ kind: 'confirm', ...options, resolve });
  });
}

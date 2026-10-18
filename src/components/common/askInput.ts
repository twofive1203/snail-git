import { pushDialog, type AskInputOptions } from './dialogQueue';

export type { AskInputOptions };

/**
 * 项目风格的输入弹窗，替代 window.prompt。
 * 取消 / Esc / 点遮罩都解析为 null，与「输入了空字符串」区分开。
 * 空值与校验失败都不会 resolve，用户必须给出合法值或取消。
 */
export function askInput(options: AskInputOptions): Promise<string | null> {
  return new Promise((resolve) => {
    pushDialog({ kind: 'input', ...options, resolve });
  });
}

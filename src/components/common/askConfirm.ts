export interface AskConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** primary 蓝色实心，danger 红色描边，default 普通描边。 */
  tone?: 'primary' | 'danger' | 'default';
  files?: string[];
}

interface Pending extends AskConfirmOptions {
  resolve: (value: boolean) => void;
}

type Listener = (current: AskConfirmOptions | null) => void;

const queue: Pending[] = [];
const listeners = new Set<Listener>();

function emit() {
  const current = queue[0] ?? null;
  for (const listener of listeners) listener(current);
}

/** 订阅当前待确认项。宿主挂载前发起的确认会排队，挂载后立刻显示。 */
export function subscribeConfirm(listener: Listener) {
  listeners.add(listener);
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
  };
}

export function isAskConfirmOpen() {
  return queue.length > 0;
}

/** 项目风格的二次确认，替代 window.confirm。取消、Esc、点遮罩都解析为 false。 */
export function askConfirm(options: AskConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ ...options, resolve });
    if (queue.length === 1) emit();
  });
}

export function settleConfirm(value: boolean) {
  const current = queue.shift();
  emit();
  current?.resolve(value);
}

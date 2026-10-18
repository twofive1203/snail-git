export interface AskConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** primary 蓝色实心，danger 红色描边，default 普通描边。 */
  tone?: 'primary' | 'danger' | 'default';
  files?: string[];
}

export interface AskInputOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'default';
  /** 返回错误文案表示不合法；空字符串本身也算不合法，不用在这里重复判空。 */
  validate?: (value: string) => string | null;
}

/**
 * 确认框和输入框共用一条队列。
 * 共用而不是各排一条，是为了保证同一时刻只渲染一个弹窗：两个队列各自排队时，
 * 同时触发 confirm + input 会叠在一起。
 */
export type DialogRequest =
  | ({ kind: 'confirm'; resolve: (value: boolean) => void } & AskConfirmOptions)
  | ({ kind: 'input'; resolve: (value: string | null) => void } & AskInputOptions);

type Listener = (current: DialogRequest | null) => void;

const queue: DialogRequest[] = [];
const listeners = new Set<Listener>();

function emit() {
  const current = queue[0] ?? null;
  for (const listener of listeners) listener(current);
}

/** 订阅队首弹窗。宿主挂载前发起的请求会排队，挂载后立刻显示。 */
export function subscribeDialog(listener: Listener) {
  listeners.add(listener);
  listener(queue[0] ?? null);
  return () => {
    listeners.delete(listener);
  };
}

/** 任一弹窗处于打开状态。全局快捷键必须用它拦截，否则输入框开着时 Ctrl+K 仍会切页签。 */
export function isDialogOpen() {
  return queue.length > 0;
}

export function pushDialog(request: DialogRequest) {
  queue.push(request);
  if (queue.length === 1) emit();
}

export function settleConfirm(value: boolean) {
  const current = queue[0];
  if (current?.kind !== 'confirm') return;
  queue.shift();
  emit();
  current.resolve(value);
}

export function settleInput(value: string | null) {
  const current = queue[0];
  if (current?.kind !== 'input') return;
  queue.shift();
  emit();
  current.resolve(value);
}

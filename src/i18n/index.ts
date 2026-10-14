import { en, zh, type MessageKey } from './messages';

export type Locale = 'zh' | 'en';
export type { MessageKey };

export const LOCALE_STORAGE_KEY = 'easy-git.locale';

const TITLES: Record<Locale, string> = {
  zh: zh['app.title'],
  en: en['app.title'],
};

const HTML_LANG: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
};

type Listener = (locale: Locale) => void;

const listeners = new Set<Listener>();

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // 浏览器禁止本地存储时保持默认中文，不探测系统语言。
  }
  return 'zh';
}

let current: Locale = readStoredLocale();

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = HTML_LANG[locale];
  document.title = TITLES[locale];
}

async function syncWindowTitle(title: string) {
  try {
    const { isTauriEnvironment } = await import('../services/gitService');
    if (!isTauriEnvironment()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch {
    // 标题同步失败不影响页面内切换；浏览器预览没有 Tauri 窗口。
  }
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale) {
  if (next !== 'zh' && next !== 'en') return;
  current = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    // 写不进去时本次会话仍然切换，刷新后回到默认中文。
  }
  applyDocumentLocale(next);
  void syncWindowTitle(TITLES[next]);
  listeners.forEach(listener => listener(next));
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const table = current === 'en' ? en : zh;
  const template = table[key] || zh[key] || key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

applyDocumentLocale(current);
void syncWindowTitle(TITLES[current]);

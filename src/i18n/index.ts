import { en, zh, type MessageKey } from './messages';

export type Locale = 'zh' | 'en';
export type { MessageKey };

export const LOCALE_STORAGE_KEY = 'snail-git.locale';

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

function migrateLegacyStorage() {
  try {
    const moves: Array<[string, string]> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('easygit.')) moves.push([key, `snailgit.${key.slice('easygit.'.length)}`]);
      else if (key.startsWith('easy-git.')) moves.push([key, `snail-git.${key.slice('easy-git.'.length)}`]);
    }
    for (const [from, to] of moves) {
      if (localStorage.getItem(to) == null) {
        const value = localStorage.getItem(from);
        if (value != null) localStorage.setItem(to, value);
      }
      localStorage.removeItem(from);
    }
  } catch {
    // 旧键迁不过去时使用新键默认值，不阻塞启动。
  }
}

function readStoredLocale(): Locale {
  migrateLegacyStorage();
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

async function syncTrayLocale(locale: Locale) {
  try {
    const { isTauriEnvironment } = await import('../services/gitService');
    if (!isTauriEnvironment()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    const table = locale === 'en' ? en : zh;
    await invoke('set_tray_locale', {
      show: table['tray.show'],
      quit: table['tray.quit'],
    });
  } catch {
    // 托盘还没建好或浏览器预览时忽略，不影响语言切换。
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
  void syncTrayLocale(next);
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
void syncTrayLocale(current);

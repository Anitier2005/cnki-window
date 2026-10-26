import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Bookmark, CnkiDoc, HistoryItem } from '@/core/types/cnki';

/**
 * 极简本地存储：收藏 / 浏览历史 / 检索词。
 *
 * 没有引入状态管理库 —— 这点数据量用订阅 + AsyncStorage 足够，
 * 少一个依赖少一层心智负担。
 */

const KEY_BOOKMARKS = '@cnki/bookmarks';
const KEY_HISTORY = '@cnki/history';
const KEY_SEARCHES = '@cnki/searches';
const KEY_SETTINGS = '@cnki/settings';

const HISTORY_LIMIT = 300;
const SEARCH_LIMIT = 30;

type Listener = () => void;

/**
 * 最近一次落盘失败的原因。
 * AsyncStorage 在某些原生装配下会直接抛「Module is null」，
 * 而界面上只是「点了收藏下次打开就没了」——没有这条就完全查不出来。
 */
let lastStorageError = '';

class Collection<T> {
  private value: T[] = [];
  private listeners = new Set<Listener>();
  private loaded = false;
  /** 读盘过程中用户已经改过内容：此时别用磁盘数据覆盖内存 */
  private touched = false;

  constructor(
    private key: string,
    private options: {
      /** 去重键 */
      keyOf?: (item: T) => string;
      limit?: number;
      /** 新增项放在最前 */
      prepend?: boolean;
    } = {},
  ) {}

  async load(): Promise<T[]> {
    if (this.loaded) return this.value;
    let stored: T[] = [];
    try {
      const raw = await AsyncStorage.getItem(this.key);
      stored = raw ? (JSON.parse(raw) as T[]) : [];
    } catch (err: any) {
      lastStorageError = `读 ${this.key} 失败：${err?.message || err}`;
      stored = [];
    }
    /* 读盘是异步的：这中间用户可能已经点过收藏，别把刚加进来的覆盖掉 */
    if (!this.touched) this.value = stored;
    this.loaded = true;
    this.emit();
    return this.value;
  }

  get(): T[] {
    return this.value;
  }

  private async persist() {
    try {
      await AsyncStorage.setItem(this.key, JSON.stringify(this.value));
    } catch (err: any) {
      lastStorageError = `写 ${this.key} 失败：${err?.message || err}`;
      console.warn('[store] persist failed', lastStorageError);
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async add(item: T) {
    const keyOf = this.options.keyOf;
    let next = [item, ...this.value];
    if (keyOf) {
      /*
       * 去重：新条目排在最前，所以「保留第一次出现」就等于保留它、
       * 丢掉后面同 id 的旧副本。
       * 这里曾经把新条目的 key 预先塞进 seen，结果每次 add 都把自己
       * 过滤掉——界面上收藏按钮能点亮，但列表永远是 0 条。
       */
      const seen = new Set<string>();
      next = next.filter((it) => {
        const ik = keyOf(it);
        if (seen.has(ik)) return false;
        seen.add(ik);
        return true;
      });
    }
    if (this.options.limit) next = next.slice(0, this.options.limit);
    this.value = next;
    this.touched = true;
    this.emit();
    await this.persist();
  }

  async remove(predicate: (item: T) => boolean) {
    this.value = this.value.filter((it) => !predicate(it));
    this.touched = true;
    this.emit();
    await this.persist();
  }

  async clear() {
    this.value = [];
    this.touched = true;
    this.emit();
    await this.persist();
  }

  has(predicate: (item: T) => boolean): boolean {
    return this.value.some(predicate);
  }
}

export const bookmarks = new Collection<Bookmark>(KEY_BOOKMARKS, {
  keyOf: (b) => b.id,
});
export const history = new Collection<HistoryItem>(KEY_HISTORY, {
  keyOf: (h) => h.id,
  limit: HISTORY_LIMIT,
});
export const searchHistory = new Collection<string>(KEY_SEARCHES, {
  keyOf: (s) => s,
  limit: SEARCH_LIMIT,
});

/** 通用订阅 hook */
export function useCollection<T>(col: Collection<T>): T[] {
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    col.load().then(() => alive && force((n) => n + 1));
    const unsub = col.subscribe(() => alive && force((n) => n + 1));
    return () => {
      alive = false;
      unsub();
    };
  }, [col]);
  return col.get();
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */
export interface AppSettings {
  /** 是否在下载/阅读时用外链交给系统浏览器 */
  preferExternalReader: boolean;
  /** 只在 Wi-Fi 下预加载 */
  wifiOnly: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  preferExternalReader: false,
  wifiOnly: true,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SETTINGS);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 工具：生成引用文本                                                  */
/* ------------------------------------------------------------------ */
export function formatCitation(doc: CnkiDoc): string {
  const authors = doc.authors.join(', ');
  const parts = [authors, doc.title, doc.source];
  if (doc.date) parts.push(doc.date);
  return parts.filter(Boolean).join('. ') + '.';
}

/** 初始化：启动时预热一次，避免首屏列表闪烁 */
export async function warmupStorage(): Promise<void> {
  await Promise.all([bookmarks.load(), history.load(), searchHistory.load()]);
}

/**
 * 直接从持久层读一遍条数。
 * 内存里的列表和落盘内容不一致时（例如界面显示 0 条但确实点过收藏），
 * 设置页会拿它做对照，-1 表示这一步就读失败了。
 */
export async function storedCounts(): Promise<{ bookmarks: number; history: number }> {
  const read = async (key: string) => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return -1;
    }
  };
  return { bookmarks: await read(KEY_BOOKMARKS), history: await read(KEY_HISTORY) };
}

/** 落盘失败的原因，空串表示一切正常 */
export function storageError(): string {
  return lastStorageError;
}

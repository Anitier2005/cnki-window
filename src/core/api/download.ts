/*
 * 全文下载。
 *
 * 为什么不直接把下载地址丢给系统浏览器：
 * 知网 bar 网关会校验来源，光有 URL 打不开；而且外部浏览器拿不到
 * WebView 里的机构登录 cookie，最后只会落到登录页。
 *
 * 所以下载走原生 HTTP：cookie 从 WebView 借（document.cookie），
 * Referer 用文章详情页地址，这样网关才认。文件存到应用私有目录，
 * 不碰外部存储，也就不需要任何存储权限。
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { DESKTOP_UA } from '@/core/bridge/SessionProvider';
import { mimeForExt } from '@/core/api/mime';

export type DownloadFailCode = 'network' | 'denied' | 'no-viewer';

export class DownloadError extends Error {
  code: DownloadFailCode;
  constructor(code: DownloadFailCode, message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

/** 文件名里不能出现路径分隔符和 Windows 保留字符 */
function safeName(title: string, ext: string): string {
  const base = (title || 'cnki-paper')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || 'cnki-paper'}.${ext}`;
}

function papersDir(): Directory {
  const dir = new Directory(Paths.document, 'papers');
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

/** 文件大小按人话显示：小于 1MB 时用 KB，否则 MB。0.0 MB 看不出是空壳还是小文件 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

type SniffKind = 'pdf' | 'zip' | 'html' | 'json' | 'other';

/**
 * 读文件头判断真实内容。
 *
 * 知网的下载网关在「这篇文献没有该格式」或「权限过期」时不会报错，
 * 而是回一个 200 的网页（有时还不小），落盘后看起来就是个文件。
 * 只看大小判断不出来，所以按魔数/首字符认。
 */
async function sniff(file: File): Promise<{ kind: SniffKind; text: string }> {
  const handle = file.open();
  let head: Uint8Array;
  try {
    head = await handle.readBytes(512);
  } finally {
    handle.close();
  }
  const raw = String.fromCharCode(...head.slice(0, 16));
  if (raw.startsWith('%PDF')) return { kind: 'pdf', text: '' };
  if (raw.startsWith('PK\u0003\u0004')) return { kind: 'zip', text: '' };
  let text: string;
  try {
    text = new TextDecoder().decode(head);
  } catch {
    text = String.fromCharCode(...head);
  }
  text = text.trimStart();
  if (text.startsWith('<')) return { kind: 'html', text };
  if (text.startsWith('{') || text.startsWith('[')) return { kind: 'json', text };
  return { kind: 'other', text: '' };
}

export interface DownloadResult {
  file: File;
  /** 实际类型算出来的 MIME，可能和请求时的预期不同 */
  mime: string;
}

export interface DownloadOptions {
  url: string;
  /** 文章详情页地址，网关用它校验来源 */
  referer: string;
  /** WebView 里的 document.cookie */
  cookie: string;
  title: string;
  ext: string;
  onProgress?: (ratio: number) => void;
}

/** 下载一个文件到应用私有目录，返回落盘后的 File */
export async function downloadToFile(opts: DownloadOptions): Promise<DownloadResult> {
  const target = new File(papersDir(), safeName(opts.title, opts.ext));
  if (target.exists) target.delete();

  let file: File;
  try {
    file = await File.downloadFileAsync(opts.url, target, {
      idempotent: true,
      headers: {
        Cookie: opts.cookie,
        Referer: opts.referer,
        'User-Agent': DESKTOP_UA,
        Accept: '*/*',
      },
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (opts.onProgress && totalBytes > 0) {
          opts.onProgress(Math.min(1, bytesWritten / totalBytes));
        }
      },
    });
  } catch (err: any) {
    throw new DownloadError('network', err?.message || '下载失败，请检查网络');
  }

  /*
   * 没有权限、或者这篇文献没有该格式时，网关不会报错，而是回一个 200 的网页。
   * 这种「看起来成功」的响应必须识别出来，否则用户会得到一个打不开的假文件。
   */
  if (!file.exists || file.size === 0) {
    throw new DownloadError('network', '下载内容为空，请稍后重试');
  }

  const sniffed = await sniff(file);
  if (sniffed.kind === 'html' || sniffed.kind === 'json') {
    const size = file.size;
    file.delete();
    if (/登录|权限|来源应用|安全验证|滑块|验证码/i.test(sniffed.text)) {
      throw new DownloadError('denied', '机构权限已过期，请完成 IP 登录后重试');
    }
    throw new DownloadError(
      'denied',
      `知网没有返回文件（收到的是 ${formatSize(size)} 的提示页），这篇文献可能没有该格式`,
    );
  }

  /* CAJ 按钮有时实际回的是 PDF，按真实内容改名，避免用户拿到扩展名骗人的文件 */
  const actualExt = sniffed.kind === 'pdf' ? 'pdf' : sniffed.kind === 'zip' ? 'zip' : opts.ext;
  if (actualExt !== opts.ext) {
    const renamed = new File(papersDir(), safeName(opts.title, actualExt));
    if (renamed.exists) renamed.delete();
    await file.move(renamed);
    file = new File(renamed.uri);
  }

  return { file, mime: mimeForExt(actualExt) };
}

/**
 * 用系统应用打开文件。
 *
 * 私有目录的文件必须转成 content:// 再交给别的应用，并且要显式授予
 * 读权限，否则对方会拿到 SecurityException。
 *
 * 打不开时不再自动弹分享面板：模拟器和精简系统上分享目标可能只有蓝牙，
 * 用户会被莫名其妙带进配对界面。这里只报「没有可打开的应用」，
 * 要不要分享由界面上的按钮决定（见 shareFile）。
 */
export async function openFile(file: File, mime: string): Promise<void> {
  const uri = await FileSystemLegacy.getContentUriAsync(file.uri);
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: uri,
      type: mime,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
    return;
  } catch {
    throw new DownloadError(
      'no-viewer',
      `已保存为「${file.name}」（${formatSize(file.size)}），但设备上没有能打开该格式的应用`,
    );
  }
}

/** 用户主动点「分享」时才唤起系统分享面板 */
export async function shareFile(file: File, mime: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new DownloadError('no-viewer', '系统分享不可用');
  }
  await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: '分享全文' });
}

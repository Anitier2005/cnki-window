/**
 * 文件类型与扩展名的唯一映射表。
 *
 * 之前这份表在 download.ts 和详情页各写了一遍：下载那边用来纠正
 * 「CAJ 链接实际回 PDF」的情况，详情页用来猜附件是什么格式。
 * 两处一旦不同步，就会出现「下载认出是 PDF、详情页却按 CAJ 打开」的怪事，
 * 所以统一收到这里。
 */
export const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  caj: 'application/octet-stream',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  txt: 'text/plain',
};

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[(ext || '').toLowerCase()] || 'application/octet-stream';
}

/**
 * 猜附件的扩展名。
 *
 * 知网附件的链接常常是 bar 网关的裸地址（没有扩展名），所以先看附件名，
 * 再看 URL 结尾；都判断不出来时按 PDF 处理 —— 打不开还能从系统分享面板
 * 换个应用接手，总比存成一个没有扩展名、谁都不认的文件强。
 */
export function guessExt(name: string, url: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec((name || '').trim());
  if (fromName && MIME_BY_EXT[fromName[1].toLowerCase()]) {
    return fromName[1].toLowerCase();
  }
  const fromUrl = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url || '');
  if (fromUrl && MIME_BY_EXT[fromUrl[1].toLowerCase()]) {
    return fromUrl[1].toLowerCase();
  }
  return 'pdf';
}

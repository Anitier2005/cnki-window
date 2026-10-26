import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Paperclip,
  Quote,
  Share2,
} from 'lucide-react-native';
import { useSession } from '@/core/bridge/SessionProvider';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { getDocDetail, CnkiError } from '@/core/api/cnki';
import { downloadToFile, openFile, shareFile, DownloadError } from '@/core/api/download';
import { guessExt } from '@/core/api/mime';
import { bookmarks, formatCitation, history } from '@/core/storage/store';
import { DocDetail } from '@/core/types/cnki';
import { RootStackParamList, RootNav } from '@/app/navigation/types';
import { colors, docTypeMeta, fontSize, radius, shadow, spacing } from '@/shared/theme/theme';

type Route = RouteProp<RootStackParamList, 'Detail'>;

/** 详情页上的一个全文入口 */
interface FulltextEntry {
  key: string;
  label: string;
  desc: string;
  url: string;
  kind: 'read' | 'download';
  ext?: string;
  /** 落盘文件名（附件要用自己的名字，否则同一篇文献的多个附件会互相覆盖） */
  fileBase?: string;
}

function entryIcon(key: string) {
  const color = colors.primary;
  if (key === 'read' || key === 'yb') {
    return <BookOpen size={18} color={color} strokeWidth={2} />;
  }
  if (key === 'pdf') {
    return <FileText size={18} color={color} strokeWidth={2} />;
  }
  if (key === 'caj') {
    return <Download size={18} color={color} strokeWidth={2} />;
  }
  return <Paperclip size={18} color={color} strokeWidth={2} />;
}

export function DetailScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const { request, openLogin, session, getCookies } = useSession();
  const r = useResponsive();
  useStatusBarStyle(false);

  const base = route.params.doc;
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CnkiError | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 正在下载的入口标识，用于给对应按钮显示进度；null 表示空闲 */
  const [busy, setBusy] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0);

  const meta = docTypeMeta[base.type] ?? docTypeMeta.other;

  useEffect(() => {
    let alive = true;
    (async () => {
      history.add({ ...base, viewedAt: Date.now() });
      await bookmarks.load();
      if (alive) setSaved(bookmarks.has((b) => b.id === base.id));

      try {
        const d = await getDocDetail(request, base);
        if (alive) {
          setDetail(d);
          setLoading(false);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(
          err instanceof CnkiError ? err : new CnkiError('UNKNOWN', err?.message || '加载失败'),
        );
        setLoading(false);
        // 详情抓取失败时仍展示检索结果里已有的信息，不把页面做成白屏
        setDetail({ ...base });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.id]);

  const toggleSave = async () => {
    if (saved) {
      await bookmarks.remove((b) => b.id === base.id);
      setSaved(false);
    } else {
      await bookmarks.add({ ...base, savedAt: Date.now() });
      setSaved(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  const copyCitation = async () => {
    await Clipboard.setStringAsync(formatCitation(detail || base));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('已复制', '参考文献格式已复制到剪贴板');
  };

  const copyLink = async () => {
    await Clipboard.setStringAsync(base.href);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('已复制', '文献链接已复制到剪贴板');
  };

  const openUrl = async (url?: string) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('打开失败', '无法唤起外部应用，请检查链接是否有效');
    }
  };

  const d = detail || { ...base };
  const docTitle = d.title || base.title;

  /** 在线阅读 / 原版阅读都在应用内的 ReaderScreen 里打开 */
  const openReader = (en: FulltextEntry) => {
    nav.navigate('Reader', {
      url: en.url,
      title: docTitle,
      // 带着详情页做跳板，网关才认 Referer
      via: d.href,
      label: en.label,
    });
  };

  /**
   * 下载并打开。
   * 下载不是「把 URL 丢给浏览器」——bar 网关会校验来源和机构 cookie，
   * 必须由原生层带着 WebView 的会话去取（见 api/download.ts）。
   */
  const runDownload = async (opts: {
    key: string;
    url: string;
    ext: string;
    name: string;
  }) => {
    if (busy) return;
    setBusy(opts.key);
    setRatio(0);
    try {
      const { cookie } = await getCookies();
      if (!cookie) throw new DownloadError('denied', '会话已失效，请重新完成 IP 登录');
      const file = await downloadToFile({
        url: opts.url,
        referer: base.href,
        cookie,
        title: opts.name,
        ext: opts.ext,
        onProgress: setRatio,
      });
      try {
        /*
         * PDF 一律在应用内打开：手机上装没装 PDF 阅读器全看运气，
         * 而且跳出去再回来还得重新找这篇文献。想用别的应用，
         * 阅读器右上角留了「外部打开」的入口。
         */
        if (file.mime === 'application/pdf') {
          nav.navigate('PdfReader', { uri: file.file.uri, title: file.file.name });
          return;
        }
        await openFile(file.file, file.mime);
      } catch (err) {
        // 文件已经落盘，只是没有能打开它的应用：交给用户决定要不要分享
        if (err instanceof DownloadError && err.code === 'no-viewer') {
          Alert.alert('下载完成', err.message, [
            {
              text: '分享',
              onPress: () => {
                shareFile(file.file, file.mime).catch(() =>
                  Alert.alert('分享失败', '系统分享不可用'),
                );
              },
            },
            { text: '知道了', style: 'cancel' },
          ]);
          return;
        }
        throw err;
      }
    } catch (err: any) {
      const denied = err instanceof DownloadError && err.code === 'denied';
      Alert.alert(
        '下载失败',
        err?.message || '请稍后重试',
        denied
          ? [
              { text: '去登录', onPress: () => openLogin() },
              { text: '知道了', style: 'cancel' },
            ]
          : [{ text: '知道了' }],
      );
    } finally {
      setBusy(null);
      setRatio(0);
    }
  };
  const abstractText = d.abstractCn || '';
  const hasFullAbstract = abstractText.length > 160;

  /*
   * 全文入口。
   * 知网详情页上「HTML阅读 / 原版阅读 / CAJ / PDF / 附件」是并列的几颗按钮，
   * 能不能用取决于文献本身和机构权限，所以这里按实际抓到的链接动态生成，
   * 有一个给一个，不写死。
   */
  const entries: FulltextEntry[] = [];
  if (d.readUrl) {
    entries.push({
      key: 'read',
      label: 'HTML 阅读',
      desc: '正文按段落重排，手机上最好读',
      url: d.readUrl,
      kind: 'read',
    });
  }
  if (d.ybUrl) {
    entries.push({
      key: 'yb',
      label: '原版阅读',
      desc: '保留原版版式，图表位置一致',
      url: d.ybUrl,
      kind: 'read',
    });
  }
  if (d.pdfUrl) {
    entries.push({
      key: 'pdf',
      label: '下载 PDF',
      desc: '保存到本机，在应用内阅读',
      url: d.pdfUrl,
      kind: 'download',
      ext: 'pdf',
    });
  }
  if (d.cajUrl) {
    entries.push({
      key: 'caj',
      label: '下载 CAJ',
      desc: '知网原生格式，需 CAJViewer',
      url: d.cajUrl,
      kind: 'download',
      ext: 'caj',
    });
  }
  (d.attachments || []).forEach((a, i) => {
    const ext = guessExt(a.name, a.url);
    entries.push({
      key: `att-${i}`,
      label: a.name,
      desc: '论文附件 / 补充材料',
      url: a.url,
      kind: 'download',
      ext,
      fileBase: `${docTitle.slice(0, 36)}_${a.name}`,
    });
  });

  /* 底部主按钮：优先「能读」的，其次是 PDF，再次 CAJ */
  const primary =
    entries.find((e) => e.kind === 'read') ||
    entries.find((e) => e.key === 'pdf') ||
    entries.find((e) => e.key === 'caj');

  /**
   * 全文入口面板。
   * 手机上它跟在标题下面（一屏就能看到，不用翻到底）；
   * 平板上挪到右栏，和摘要并排 —— 左边的字不会因为变宽而拉成一整行。
   */
  const entriesCard = () => (
    <View style={styles.card}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardTitle}>获取全文</Text>
        {entries.length > 0 && (
          <Text style={styles.abstractCount}>{entries.length} 个入口</Text>
        )}
      </View>

      {entries.length > 0 ? (
        entries.map((en, i) => {
          const running = busy === en.key;
          return (
            <Pressable
              key={en.key}
              disabled={!!busy}
              onPress={() =>
                en.kind === 'read'
                  ? openReader(en)
                  : runDownload({
                      key: en.key,
                      url: en.url,
                      ext: en.ext || 'pdf',
                      name: en.fileBase || docTitle,
                    })
              }
              style={({ pressed }) => [
                styles.entryRow,
                i > 0 && styles.entryDivider,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={styles.entryIcon}>{entryIcon(en.key)}</View>
              <View style={styles.entryBody}>
                <Text style={styles.entryLabel} numberOfLines={1}>
                  {en.label}
                </Text>
                <Text style={styles.entryDesc} numberOfLines={1}>
                  {running ? `下载中 ${Math.round(ratio * 100)}%` : en.desc}
                </Text>
                {running && (
                  <View style={styles.entryTrack}>
                    <View
                      style={[styles.entryBar, { width: `${Math.max(4, ratio * 100)}%` }]}
                    />
                  </View>
                )}
              </View>
              {running ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <ChevronRight size={16} color={colors.textTertiary} strokeWidth={2} />
              )}
            </Pressable>
          );
        })
      ) : loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>正在解析全文入口…</Text>
        </View>
      ) : (
        <>
          <Text style={styles.emptyText}>
            {error?.code === 'BLOCKED'
              ? '需要完成安全验证后才能获取全文'
              : '这篇文献没有可用的全文入口，可前往知网原页查看'}
          </Text>
          {error?.code === 'BLOCKED' && (
            <Pressable onPress={() => openLogin()} hitSlop={6} style={styles.inlineLink}>
              <Text style={styles.inlineLinkText}>去完成 IP 登录</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={2.2} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={toggleSave} hitSlop={10} style={styles.headerBtn}>
          {saved ? (
            <BookmarkCheck size={20} color={colors.accent} strokeWidth={2} />
          ) : (
            <Bookmark size={20} color={colors.textSecondary} strokeWidth={2} />
          )}
        </Pressable>
        <Pressable onPress={copyCitation} hitSlop={10} style={styles.headerBtn}>
          <Share2 size={19} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
          <View style={r.wide ? styles.twoCol : undefined}>
            <View style={r.wide ? styles.colMain : undefined}>
        <View style={styles.titleBlock}>
          <View style={styles.badgeRow}>
            <View style={[styles.typeBadge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.typeText, { color: meta.color }]}>{meta.label}</Text>
            </View>
            {!!d.date && <Text style={styles.dateText}>{d.date}</Text>}
            {d.cited !== undefined && (
              <Text style={styles.metric}>被引 {d.cited}</Text>
            )}
            {d.downloads !== undefined && (
              <Text style={styles.metric}>下载 {d.downloads}</Text>
            )}
          </View>

          <Text style={styles.title} selectable>
            {d.title}
          </Text>

          {d.authors.length > 0 && (
            <Text style={styles.authors} selectable>
              {d.authors.join('　')}
            </Text>
          )}

          {!!d.source && (
            <View style={styles.sourceBox}>
              <Text style={styles.sourceLabel}>出处</Text>
              <Text style={styles.sourceValue}>{d.source}</Text>
            </View>
          )}
        </View>

        {/* 全文入口：手机上紧跟标题；平板上挪到右栏，和摘要并排 */}
        {!r.wide && entriesCard()}

        {/* 摘要 —— 手机端最主要的阅读内容，优先给足空间 */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle}>摘要</Text>
            {hasFullAbstract && (
              <Text style={styles.abstractCount}>{abstractText.length} 字</Text>
            )}
          </View>
          {loading && !abstractText ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>正在获取摘要…</Text>
            </View>
          ) : abstractText ? (
            <>
              <Text
                style={styles.abstract}
                numberOfLines={expanded ? undefined : 6}
                selectable
              >
                {abstractText}
              </Text>
              {hasFullAbstract && (
                <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6} style={styles.expandBtn}>
                  <Text style={styles.expandText}>{expanded ? '收起' : '展开全文'}</Text>
                </Pressable>
              )}
            </>
          ) : (
            <Text style={styles.emptyText}>
              {error?.code === 'BLOCKED'
                ? '会话需要重新验证，登录后可查看完整摘要'
                : '该文献暂无可解析的中文摘要，可前往知网原页查看'}
            </Text>
          )}
        </View>

        {d.keywordsCn && d.keywordsCn.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>关键词</Text>
            <View style={styles.kwWrap}>
              {d.keywordsCn.map((k) => (
                <Pressable
                  key={k}
                  onPress={() =>
                    nav.navigate('SearchResult', { keyword: k, field: 'KY' })
                  }
                  style={({ pressed }) => [styles.kwChip, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.kwText}>{k}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {d.funds && d.funds.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>基金资助</Text>
            {d.funds.map((f) => (
              <Text key={f} style={styles.fundText} selectable>
                {f}
              </Text>
            ))}
          </View>
        )}

        {(d.refCount !== undefined || d.citeCount !== undefined || d.doi) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>文献信息</Text>
            {d.doi && <InfoRow label="DOI" value={d.doi} />}
            {d.refCount !== undefined && <InfoRow label="参考文献" value={`${d.refCount} 条`} />}
            {d.citeCount !== undefined && <InfoRow label="引证文献" value={`${d.citeCount} 条`} />}
          </View>
        )}

        {error && error.code !== 'BLOCKED' && (
          <Text style={styles.warnText}>{error.message}</Text>
        )}
            </View>

            {/* 平板：右栏放全文入口，跟着视口停在右上，不随左栏滚走 */}
            {r.wide && <View style={styles.colSide}>{entriesCard()}</View>}
          </View>
        </View>
      </ScrollView>

      {/* 底部主按钮：跟着「获取全文」里最值得先点的入口走，下载进度也在这里回显 */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
        {primary ? (
          <>
            <Pressable
              disabled={!!busy}
              onPress={() =>
                primary.kind === 'read'
                  ? openReader(primary)
                  : runDownload({
                      key: primary.key,
                      url: primary.url,
                      ext: primary.ext || 'pdf',
                      name: primary.fileBase || docTitle,
                    })
              }
              style={styles.primaryBtn}
            >
              {busy === primary.key ? (
                <>
                  <ActivityIndicator size="small" color={colors.textInverse} />
                  <Text style={styles.primaryText}>{Math.round(ratio * 100)}%</Text>
                </>
              ) : (
                <>
                  {primary.kind === 'read' ? (
                    <BookOpen size={17} color={colors.textInverse} strokeWidth={2.4} />
                  ) : (
                    <Download size={17} color={colors.textInverse} strokeWidth={2.4} />
                  )}
                  <Text style={styles.primaryText}>
                    {primary.kind === 'read'
                      ? '在线阅读全文'
                      : `下载 ${(primary.ext || 'pdf').toUpperCase()}`}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable onPress={toggleSave} style={styles.iconBtn}>
              {saved ? (
                <BookmarkCheck size={19} color={colors.primary} fill={colors.primary} strokeWidth={2} />
              ) : (
                <Bookmark size={19} color={colors.textSecondary} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable onPress={copyCitation} style={styles.iconBtn}>
              <Quote size={19} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
            <Pressable onPress={copyLink} style={styles.iconBtn}>
              <LinkIcon size={19} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </>
        ) : error?.code === 'BLOCKED' || session.status === 'anonymous' ? (
          <>
            <Pressable
              onPress={() =>
                openLogin(undefined, { keepOpen: error?.code === 'BLOCKED' })
              }
              style={[styles.primaryBtn, styles.warnBtn]}
            >
              <Text style={styles.primaryText}>
                {error?.code === 'BLOCKED' ? '先完成安全验证' : '完成 IP 登录后下载全文'}
              </Text>
            </Pressable>
            <Pressable onPress={toggleSave} style={styles.iconBtn}>
              {saved ? (
                <BookmarkCheck size={19} color={colors.primary} fill={colors.primary} strokeWidth={2} />
              ) : (
                <Bookmark size={19} color={colors.textSecondary} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable onPress={copyLink} style={styles.iconBtn}>
              <LinkIcon size={19} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => openUrl(d.href)} style={styles.primaryBtn}>
              <ExternalLink size={17} color={colors.textInverse} strokeWidth={2.4} />
              <Text style={styles.primaryText}>在知网查看原文</Text>
            </Pressable>
            <Pressable onPress={toggleSave} style={styles.iconBtn}>
              {saved ? (
                <BookmarkCheck size={19} color={colors.primary} fill={colors.primary} strokeWidth={2} />
              ) : (
                <Bookmark size={19} color={colors.textSecondary} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable onPress={copyCitation} style={styles.iconBtn}>
              <Quote size={19} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
            <Pressable onPress={copyLink} style={styles.iconBtn}>
              <LinkIcon size={19} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  /* 平板分两栏：左边标题 + 摘要，右边全文入口 */
  twoCol: { flexDirection: 'row', alignItems: 'flex-start' },
  colMain: { flex: 1.35, minWidth: 0 },
  colSide: { flex: 0.8, minWidth: 300, maxWidth: 420 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerBtn: { padding: 4 },

  titleBlock: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  typeText: { fontSize: fontSize.caption, fontWeight: '700' },
  dateText: { fontSize: fontSize.caption, color: colors.textTertiary },
  metric: { fontSize: fontSize.caption, color: colors.textTertiary },
  title: {
    fontSize: 22,
    lineHeight: 32,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.3,
  },
  authors: {
    fontSize: fontSize.body,
    color: colors.primary,
    marginTop: spacing.md,
    lineHeight: 22,
  },
  sourceBox: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  sourceLabel: { fontSize: fontSize.small, color: colors.textTertiary, width: 32 },
  sourceValue: { fontSize: fontSize.small, color: colors.textSecondary, flex: 1 },

  card: {
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardFirst: {
    marginTop: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  abstractCount: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '500',
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  entryDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryBody: { flex: 1, gap: 2 },
  entryLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  entryDesc: { fontSize: fontSize.caption, color: colors.textTertiary },
  entryTrack: {
    height: 3,
    marginTop: 5,
    borderRadius: 2,
    backgroundColor: colors.primaryLight,
    overflow: 'hidden',
  },
  entryBar: { height: 3, borderRadius: 2, backgroundColor: colors.primary },
  inlineLink: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingRight: spacing.sm,
  },
  inlineLinkText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.primary,
  },
  abstract: {
    fontSize: 16,
    lineHeight: 28,
    color: colors.text,
    letterSpacing: 0.3,
  },
  expandBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingRight: spacing.sm,
  },
  expandText: {
    fontSize: fontSize.small,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    lineHeight: 21,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  loadingText: { fontSize: fontSize.small, color: colors.textTertiary },

  kwWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kwChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
  },
  kwText: { fontSize: fontSize.small, color: colors.primary },

  fundText: { fontSize: fontSize.small, color: colors.textSecondary, lineHeight: 22 },

  infoRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.md },
  infoLabel: { fontSize: fontSize.small, color: colors.textTertiary, width: 64 },
  infoValue: { fontSize: fontSize.small, color: colors.textSecondary, flex: 1 },

  warnText: {
    fontSize: fontSize.caption,
    color: colors.warning,
    textAlign: 'center',
    marginTop: spacing.lg,
  },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  warnBtn: { backgroundColor: colors.warning },
  primaryText: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.textInverse,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

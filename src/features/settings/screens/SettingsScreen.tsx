import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { useResponsive } from '@/shared/hooks/useResponsive';
import {
  ArrowLeft,
  Bug,
  Building2,
  CheckCircle2,
  ClipboardCopy,
  LogIn,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react-native';
import { useSession } from '@/core/bridge/SessionProvider';
import { checkAccess } from '@/core/api/cnki';
import { bookmarks, history, searchHistory, storageError, storedCounts } from '@/core/storage/store';
import { RootNav } from '@/app/navigation/types';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';

interface DiagResult {
  ok: boolean;
  blocked: boolean;
  message: string;
  /** 原始响应摘要，解析失败时用来看知网到底返回了什么 */
  detail?: string;
}

/**
 * 构建指纹。
 * 这个项目迭代时最大的坑是「用户说还是不行，但装的其实是上一版」，
 * 所以每次改动都要手动改这里，用户报问题时报这一行就能对齐。
 */
const BUILD_TAG = '2026-10-26 · 平板适配 · 验证码触摸转发';

export function SettingsScreen() {
  const nav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const r = useResponsive();
  useStatusBarStyle(false);
  const { session, probe, dump, openLogin, request, blocked } = useSession();

  const [probing, setProbing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [copying, setCopying] = useState(false);
  const [stored, setStored] = useState<{ bookmarks: number; history: number } | null>(null);
  const [storageErr, setStorageErr] = useState('');

  /* 进页面就读一次落盘条数：内存列表和实际存储对不上时，这里能一眼看出来 */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      storedCounts().then((n) => {
        if (!alive) return;
        setStored(n);
        setStorageErr(storageError());
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const runProbe = async () => {
    setProbing(true);
    await probe();
    setProbing(false);
  };

  /**
   * 机构名认不出来时，这是唯一能一次拿到现场的办法：
   * 它会把页头原文、所有「像机构名」的候选（含位置和 class）、
   * iframe 和 cookie 键名一起导出，比让用户描述页面强得多。
   */
  const copySnapshot = async () => {
    setCopying(true);
    try {
      const text = await dump();
      await Clipboard.setStringAsync(text);
      Alert.alert('已复制', '把这段内容发给我，就能定位为什么认不出机构名。');
    } catch (e: any) {
      Alert.alert('获取失败', e?.message || '未知错误');
    } finally {
      setCopying(false);
    }
  };

  const runDiagnose = async () => {
    setDiagnosing(true);
    setDiag(null);
    const res = await checkAccess(request);
    setDiag(res);
    setDiagnosing(false);
  };

  const clearAll = () => {
    Alert.alert('清除本地数据', '将删除收藏、浏览历史和检索记录，操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: async () => {
          await Promise.all([bookmarks.clear(), history.clear(), searchHistory.clear()]);
          Alert.alert('已清除');
        },
      },
    ]);
  };

  const statusText =
    session.status === 'ip'
      ? 'IP 授权生效'
      : session.status === 'account'
      ? '账号已登录'
      : session.status === 'checking'
      ? '检测中'
      : '未登录';

  const ok = session.status === 'ip' || session.status === 'account';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle}>设置</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        <View style={{ width: '100%', maxWidth: r.pageMax, alignSelf: 'center' }}>
        {/* 会话 */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Building2 size={16} color={colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.cardTitle}>机构会话</Text>
            <View style={{ flex: 1 }} />
            <View style={[styles.statusPill, ok ? styles.pillOk : styles.pillWarn]}>
              <Text style={[styles.statusText, ok ? styles.statusTextOk : styles.statusTextWarn]}>
                {statusText}
              </Text>
            </View>
          </View>

          <Row label="机构" value={session.orgName || '未识别'} />
          <Row
            label="最近检测"
            value={
              session.checkedAt
                ? new Date(session.checkedAt).toLocaleString('zh-CN')
                : '尚未检测'
            }
          />
          {blocked && <Row label="验证" value="当前停在安全验证页，需要手动完成" warn />}
          {!!session.error && <Row label="提示" value={session.error} warn />}
          {!!session.pageUrl && <Row label="页面" value={session.pageUrl} />}

          {!!session.evidence && (
            <View style={styles.evidenceBox}>
              <Text style={styles.evidenceLabel}>
                探测时页面页头的实际内容（判断用，不是报错信息）
              </Text>
              <Text style={styles.evidenceText} numberOfLines={3}>
                {session.evidence}
              </Text>
            </View>
          )}

          <View style={styles.btnRow}>
            <Pressable onPress={runProbe} style={styles.ghostBtn} disabled={probing}>
              {probing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <RefreshCw size={15} color={colors.primary} strokeWidth={2.2} />
              )}
              <Text style={styles.ghostText}>重新检测</Text>
            </Pressable>
            <Pressable onPress={() => openLogin(undefined, { keepOpen: true })} style={styles.solidBtn}>
              <LogIn size={15} color={colors.textInverse} strokeWidth={2.4} />
              <Text style={styles.solidText}>打开登录页</Text>
            </Pressable>
          </View>
        </View>

        {/* 诊断 */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Bug size={16} color={colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.cardTitle}>接口诊断</Text>
          </View>
          <Text style={styles.desc}>
            知网前端改版会导致解析规则失效。这里会用一次真实检索验证数据通道是否正常，
            出问题时先跑一次自检。
          </Text>

          {diag && (
            <View style={[styles.diagBox, diag.ok ? styles.diagOk : styles.diagBad]}>
              {diag.ok ? (
                <CheckCircle2 size={15} color={colors.success} strokeWidth={2.4} />
              ) : (
                <XCircle size={15} color={colors.danger} strokeWidth={2.4} />
              )}
              <Text style={[styles.diagText, { color: diag.ok ? colors.success : colors.danger }]}>
                {diag.message}
              </Text>
            </View>
          )}
          {diag?.detail ? (
            <Text style={styles.diagDetail} numberOfLines={4}>
              {diag.detail}
            </Text>
          ) : null}

          <Pressable onPress={runDiagnose} style={styles.ghostBtnWide} disabled={diagnosing}>
            {diagnosing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Bug size={15} color={colors.primary} strokeWidth={2.2} />
            )}
            <Text style={styles.ghostText}>{diagnosing ? '检测中…' : '运行自检'}</Text>
          </Pressable>

          <Pressable onPress={copySnapshot} style={styles.ghostBtnWide} disabled={copying}>
            {copying ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <ClipboardCopy size={15} color={colors.primary} strokeWidth={2.2} />
            )}
            <Text style={styles.ghostText}>
              {copying ? '正在读取页面…' : '复制页面诊断信息'}
            </Text>
          </Pressable>
          <Text style={[styles.desc, { marginTop: spacing.sm }]}>
            识别不到机构名时点这个。它会把当前知网页面的页头原文、
            所有像机构名的候选文本（含位置和 class）一起复制出来，
            发给我就能定位问题，不用你描述页面上写了什么。
          </Text>
        </View>

        {/* 数据 */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Trash2 size={16} color={colors.textSecondary} strokeWidth={2.2} />
            <Text style={styles.cardTitle}>本地数据</Text>
          </View>
          <Text style={styles.desc}>
            收藏、浏览历史与检索记录都只存在本机，不会上传到任何服务器。
            {stored ? `\n本机已存：收藏 ${stored.bookmarks} 条 · 浏览记录 ${stored.history} 条` : ''}
            {storageErr ? `\n存储异常：${storageErr}` : ''}
          </Text>
          <Pressable onPress={clearAll} style={styles.dangerBtn}>
            <Text style={styles.dangerText}>清除全部本地数据</Text>
          </Pressable>
        </View>

        {/* 关于 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>关于</Text>
          <Text style={styles.about}>
            本应用是第三方客户端，用于在校园网环境下通过机构 IP 授权访问知网资源。
            {'\n\n'}
            它不破解任何付费内容：能下载什么，完全取决于你所连网络对应的机构订购范围。
            所有请求仍由知网服务端鉴权，登录态与浏览器访问一致。
            {'\n\n'}
            为避免版权与合规风险，本应用不内置任何文献内容，也不提供离线分发能力。
          </Text>
          <Text style={styles.buildTag}>{BUILD_TAG}</Text>
        </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, warn && { color: colors.warning }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerTitle: { fontSize: fontSize.title, fontWeight: '700', color: colors.text },

  card: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: fontSize.body, fontWeight: '700', color: colors.text },

  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillOk: { backgroundColor: colors.successLight },
  pillWarn: { backgroundColor: colors.warningLight },
  statusText: { fontSize: fontSize.caption, fontWeight: '700' },
  statusTextOk: { color: colors.success },
  statusTextWarn: { color: colors.warning },

  row: { flexDirection: 'row', paddingVertical: 6, gap: spacing.md },
  rowLabel: { width: 64, fontSize: fontSize.small, color: colors.textTertiary },
  rowValue: { flex: 1, fontSize: fontSize.small, color: colors.textSecondary },

  evidenceBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    gap: 4,
  },
  evidenceLabel: { fontSize: fontSize.caption, color: colors.textTertiary },
  evidenceText: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },

  btnRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  ghostBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ghostBtnWide: {
    marginTop: spacing.lg,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ghostText: { fontSize: fontSize.small, color: colors.primary, fontWeight: '600' },
  solidBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  solidText: { fontSize: fontSize.small, color: colors.textInverse, fontWeight: '700' },

  desc: { fontSize: fontSize.caption, color: colors.textTertiary, lineHeight: 19 },
  diagBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  diagOk: { backgroundColor: colors.successLight },
  diagBad: { backgroundColor: colors.dangerLight },
  diagText: { flex: 1, fontSize: fontSize.small, fontWeight: '600' },
  diagDetail: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    fontSize: fontSize.caption,
    lineHeight: 15,
    color: colors.textTertiary,
    fontFamily: 'monospace',
  },

  dangerBtn: {
    marginTop: spacing.lg,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { fontSize: fontSize.small, color: colors.danger, fontWeight: '700' },

  about: { fontSize: fontSize.caption, color: colors.textTertiary, lineHeight: 20 },
  buildTag: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontFamily: 'monospace',
  },
});

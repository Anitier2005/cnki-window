import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Building2,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from 'lucide-react-native';
import { useSession } from '@/core/bridge/SessionProvider';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';

/**
 * 机构权限状态条。
 *
 * 这是整个 App 的前提条件，所以放在首页最上方、始终可见：
 * 用户一眼能确认「现在是不是以学校身份在访问」，而不是等检索失败了才发现没登录。
 */
export function SessionBadge() {
  const { session, openLogin, probe, blocked } = useSession();

  const isOk = session.status === 'ip' || session.status === 'account';
  const checking = session.status === 'checking';
  const isBlocked = blocked || session.reason === 'blocked';

  return (
    <Pressable
      onPress={() => {
        if (isOk) {
          probe();
        } else {
          /* 滑块验证必须由用户自己拖完：不能因为页面上恰好能读到机构名
             就自动收起面板，否则人还没动手，面板就没了 */
          openLogin(undefined, { keepOpen: isBlocked });
        }
      }}
      style={({ pressed }) => [
        styles.wrap,
        isOk ? styles.wrapOk : isBlocked ? styles.wrapDanger : styles.wrapWarn,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[styles.iconBox, isOk ? styles.iconOk : isBlocked ? styles.iconDanger : styles.iconWarn]}>
        {checking ? (
          <ActivityIndicator size="small" color={isBlocked ? colors.danger : colors.warning} />
        ) : isOk ? (
          <ShieldCheck size={16} color={colors.success} strokeWidth={2.4} />
        ) : isBlocked ? (
          <ShieldAlert size={16} color={colors.danger} strokeWidth={2.4} />
        ) : (
          <ShieldQuestion size={16} color={colors.warning} strokeWidth={2.4} />
        )}
      </View>

      <View style={{ flex: 1 }}>
        {isOk ? (
          <>
            <Text style={styles.titleOk} numberOfLines={1}>
              {session.orgName || '已登录'}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {session.status === 'ip'
                ? 'IP 授权已生效，可访问机构订购资源'
                : '账号已登录'}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.titleWarn, isBlocked && styles.titleDanger]} numberOfLines={1}>
              {checking
                ? '正在检测机构权限…'
                : isBlocked
                ? '需要先完成安全验证'
                : '未识别到机构名称'}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {checking
                ? '正在连接知网，确认当前网络的机构权限'
                : isBlocked
                ? '知网要求先过一次滑块验证，点此前往'
                : session.error || '连接校园网后点此完成 IP 登录'}
            </Text>
          </>
        )}
      </View>

      <View style={styles.right}>
        {isOk ? (
          <Building2 size={15} color={colors.success} strokeWidth={2} />
        ) : (
          <>
            <Text style={[styles.action, isBlocked && styles.actionDanger]}>
              {isBlocked ? '去验证' : '去登录'}
            </Text>
            <ChevronRight
              size={14}
              color={isBlocked ? colors.danger : colors.warning}
              strokeWidth={2.4}
            />
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
  },
  wrapOk: { backgroundColor: colors.successLight },
  wrapWarn: { backgroundColor: colors.warningLight },
  wrapDanger: { backgroundColor: colors.dangerLight },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOk: { backgroundColor: '#D5F0E3' },
  iconWarn: { backgroundColor: '#F7E9C8' },
  iconDanger: { backgroundColor: '#F6D9DE' },
  titleOk: { fontSize: fontSize.body, fontWeight: '700', color: colors.success },
  titleWarn: { fontSize: fontSize.body, fontWeight: '700', color: colors.warning },
  titleDanger: { color: colors.danger },
  sub: { fontSize: fontSize.caption, color: colors.textSecondary, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  action: { fontSize: fontSize.small, fontWeight: '600', color: colors.warning },
  actionDanger: { color: colors.danger },
});

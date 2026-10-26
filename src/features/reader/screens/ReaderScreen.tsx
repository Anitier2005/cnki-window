import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink, RotateCw } from 'lucide-react-native';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { DESKTOP_UA, useSession } from '@/core/bridge/SessionProvider';
import { RootStackParamList, RootNav } from '@/app/navigation/types';
import { colors, fontSize, radius, spacing } from '@/shared/theme/theme';

type Route = RouteProp<RootStackParamList, 'Reader'>;

const WebViewAny = WebView as unknown as React.ComponentType<any>;

/** 比较两个地址是否同一篇文献页（忽略查询串与锚点） */
function sameDoc(a: string, b: string) {
  const strip = (s: string) => (s || '').split('#')[0].split('?')[0];
  return !!a && strip(a) === strip(b);
}

/**
 * 应用内阅读页。
 *
 * 知网的「HTML阅读」和「原版阅读」最终都落在 kns.cnki.net/reader/*，
 * 正文由知网自己的脚本渲染，是一份带目录、分段、公式图片的完整全文。
 * 与其在原生层重做一套排版，不如把这一页装进 WebView：内容永远和
 * 知网同步，登录态由 cookie 直接带过去，用户也不用跳出应用。
 *
 * 但它排的是桌面版式（正文容器固定 900+ px）。这里不缩放，而是注入 CSS
 * 把这套版式整体改写成移动版：去掉目录树和工具栏，正文按屏宽重排。
 */
export function ReaderScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const { openLogin, loginVisible } = useSession();
  const r = useResponsive();
  useStatusBarStyle(false);

  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const webRef = useRef<any>(null);

  const { url, via, label, title } = route.params;
  const entered = useRef(false);

  /**
   * 在详情页上点真正的入口按钮。
   * 直接 location.href 到 bar 地址同样会带 Referer，但点按钮最贴近用户在
   * 电脑上的操作，也顺带处理了按钮上挂的前端逻辑。
   */
  const enterReader = useCallback(() => {
    const js = `(function () {
      var want = ${JSON.stringify((label || '').replace(/\s+/g, ''))};
      var here = String(location.href || '').split('#')[0];
      var tries = 0;
      function pick() {
        var as = document.querySelectorAll('a[href]');
        for (var i = 0; i < as.length; i++) {
          var t = (as[i].textContent || '').replace(/\\s+/g, '');
          if (want && t.indexOf(want) >= 0 && /^https?:/i.test(as[i].href)) return as[i];
        }
        return null;
      }
      function go() {
        var a = pick();
        if (a) {
          /* 知网这四个入口都挂着 target=_blank。WebView 没开多窗口支持时，
             点击会被静默丢弃 —— 页面一动不动，用户以为「点了没反应」。
             改成当前窗口打开再点，行为就和电脑上一样了。 */
          a.setAttribute('target', '_self');
          a.click();
          /* 点了还是没走：多半被前端脚本拦了，直接按 href 跳。
             此刻的 Referer 就是详情页，bar 网关认这个来源。 */
          setTimeout(function () {
            if (String(location.href || '').split('#')[0] === here) {
              location.href = a.href || ${JSON.stringify(url)};
            }
          }, 1500);
          return;
        }
        // 详情页的工具栏偶尔是脚本补渲染的，给它 3 秒
        if (++tries < 15) { setTimeout(go, 200); return; }
        location.href = ${JSON.stringify(url)};
      }
      go();
    })(); true;`;
    webRef.current?.injectJavaScript(js);
  }, [label, url]);

  /** 重新走一遍：先回详情页，再点入口。登录回来后也用它。 */
  const reload = useCallback(() => {
    setFailed(null);
    setNeedLogin(false);
    setLoading(true);
    entered.current = false;
    if (via) {
      webRef.current?.injectJavaScript(`location.href = ${JSON.stringify(via)}; true;`);
    } else {
      webRef.current?.reload();
    }
  }, [via]);

  /*
   * 登录浮层是盖在隐藏 WebView 上的，登录成功后它自己不会刷新这一页。
   * 所以浮层一关就重来，用户不用退出去再点一次。
   */
  const wasLoginOpen = useRef(false);
  useEffect(() => {
    if (wasLoginOpen.current && !loginVisible) reload();
    wasLoginOpen.current = loginVisible;
  }, [loginVisible, reload]);

  /**
   * 把知网的桌面版阅读页整体改写成移动版式。
   *
   * 不做等比缩放：缩放到 0.3 倍字就小到没法读，而且 Chromium 里改 zoom 会
   * 反过来影响 innerWidth，算出来的比例还会飘。
   *
   * 这里直接改布局：正文容器（#XMLContent / .ChapterContainer）宽度改成 100%，
   * 左侧目录树、右侧工具栏、顶部通栏、底部阅读工具条全部隐藏，
   * 正文字号统一到 16px / 行高 1.9，图片和表格按屏宽自适应。
   * 内容是 Vue 渲染的，类名稳定；页面分章节懒加载，所以要按几次。
   */
  const MOBILE_LAYOUT_JS = `(function () {
    var css = [
      'html,body{min-width:0!important;width:100%!important;max-width:100%!important;overflow-x:hidden!important;}',
      '#app,#printContent,.study-wrap,#pdfFullBox,.study-c,#XMLContent,.ChapterContainerWrap,#paperRead,.js-studyAchievement,.js-studyAchievement .wrap{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important;}',
      '#catalogContent,#catalog_box,.catalogboxs,.study-l,.study-r,.read-btn-box,.fixedbar,.H-Box,.img-view,.favorites-model,.el-dialog__wrapper,.el-drawer__wrapper,.loading-mask{display:none!important;}',
      '#XMLContent{padding:0!important;}',
      '.js-studyAchievement .wrap{padding:14px 16px 60px!important;}',
      '#XMLContent p,#XMLContent .ChapterWrap,#XMLContent .para{font-size:16px!important;line-height:1.9!important;}',
      '#XMLContent img{max-width:100%!important;height:auto!important;}',
      '#XMLContent table{width:100%!important;table-layout:auto!important;}',
      '#XMLContent *{max-width:100%!important;box-sizing:border-box!important;}'
    ].join('');
    try {
      /*
       * 这一页没写 viewport meta，Android WebView 会按 980px 排版再 1:1 显示，
       * 屏幕只露出左边一小块。必须先把视口改成设备宽度，下面的 100% 才有意义。
       */
      var vp = document.querySelector('meta[name="viewport"]');
      if (!vp) {
        vp = document.createElement('meta');
        vp.setAttribute('name', 'viewport');
        document.head.appendChild(vp);
      }
      vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes');

      var id = '__cnki_mobile__';
      var s = document.getElementById(id);
      if (!s) {
        s = document.createElement('style');
        s.id = id;
        document.head.appendChild(s);
      }
      s.textContent = css;
      /* 页面自己可能设过 zoom，一并清掉，否则白算了 100% 宽 */
      document.documentElement.style.zoom = '';
    } catch (e) {}
  })(); true;`;

  const applyMobileLayout = useCallback(() => {
    webRef.current?.injectJavaScript(MOBILE_LAYOUT_JS);
    // 正文是分段异步渲染的，晚一点再补几次，避免后半部分仍是旧版式
    [300, 900, 1800, 3200].forEach((t) => {
      setTimeout(() => webRef.current?.injectJavaScript(MOBILE_LAYOUT_JS), t);
    });
  }, [MOBILE_LAYOUT_JS]);

  const onLoadEnd = useCallback(
    (e: any) => {
      const at = String(e?.nativeEvent?.url || '');
      // 详情页只是跳板：停留在这里时不收起加载态，否则会闪一下原页
      if (via && !entered.current && sameDoc(at, via)) {
        entered.current = true;
        enterReader();
        return;
      }
      setLoading(false);
      /* 学位论文等没有网页版全文的文献，入口会把人带到「知网研学」推广页。
         这种页面留在 WebView 里只会让人以为阅读器坏了，直接说清楚。 */
      if (/^https?:\/\/(apix|ai)\.cnki\.net\//i.test(at)) {
        setFailed(
          '这篇文献没有网页版全文，知网只提供客户端。请返回改用「原版阅读」，或下载 PDF / CAJ。',
        );
        return;
      }
      const login = /login\.cnki\.net/i.test(at);
      setNeedLogin(login);
      if (!login) applyMobileLayout();
    },
    [via, enterReader, applyMobileLayout],
  );

  /* 跳板或阅读页卡住时别让转圈一直转下去 */
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title || '在线阅读'}
        </Text>
        <Pressable
          onPress={() => Linking.openURL(url)}
          hitSlop={10}
          style={styles.headerBtn}
        >
          <ExternalLink size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      {loading && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${Math.max(6, progress * 100)}%` }]} />
        </View>
      )}

      {needLogin && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>登录态已过期，需要重新完成 IP 登录才能阅读</Text>
          <Pressable onPress={() => openLogin()} style={styles.bannerBtn} hitSlop={6}>
            <Text style={styles.bannerBtnText}>去登录</Text>
          </Pressable>
        </View>
      )}

      {failed ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>阅读页没能加载</Text>
          <Text style={styles.errorDesc} numberOfLines={3}>
            {failed}
          </Text>
          <Pressable onPress={reload} style={styles.retry}>
            <RotateCw size={14} color={colors.primary} strokeWidth={2.6} />
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        /*
         * 平板上一行排到 1000+ px 会很难读，正文限宽后居中，
         * 留白就当是纸张的页边距。
         */
        <View style={{ flex: 1, width: '100%', maxWidth: r.readMax, alignSelf: 'center' }}>
          <WebViewAny
            ref={webRef}
            source={{ uri: via || url }}
            userAgent={DESKTOP_UA}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            domStorageEnabled
            javaScriptEnabled
            cacheEnabled
            mixedContentMode="always"
            originWhitelist={['*']}
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            onLoadProgress={(e: any) => setProgress(e.nativeEvent.progress || 0)}
            onLoadEnd={onLoadEnd}
            onError={(e: any) => {
              setLoading(false);
              setFailed(e?.nativeEvent?.description || '网络异常');
            }}
            style={styles.web}
          />
        </View>
      )}

      {loading && !failed && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  headerBtn: { padding: 4 },
  progressTrack: { height: 2, backgroundColor: colors.primaryLight },
  progressBar: { height: 2, backgroundColor: colors.primary },
  web: { flex: 1, backgroundColor: '#fff' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningLight,
  },
  bannerText: { flex: 1, fontSize: fontSize.small, color: colors.warning },
  bannerBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
  },
  bannerBtnText: { fontSize: fontSize.small, fontWeight: '700', color: colors.textInverse },

  loadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.text },
  errorDesc: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  retryText: { fontSize: fontSize.body, fontWeight: '600', color: colors.primary },
});

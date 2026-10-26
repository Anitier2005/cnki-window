/*
 * 应用内 PDF 阅读器。
 *
 * 为什么不是「交给系统应用打开」：
 * 手机上装没装 PDF 阅读器全看运气（模拟器上基本没有），而且一旦跳出去，
 * 回来还得重新找这篇文献。既然下载的文件已经在本机，就自己渲染。
 *
 * 实现方式：把 pdf.js 和文件都准备到缓存目录，再用 WebView 打开一个
 * 本地 HTML。之所以不用 WebView 直接打开 pdf 地址，是因为 Android
 * WebView 本身不解析 PDF；也不能把 PDF 塞进 data: 里，十几兆会撑爆内存。
 * 这里只把文件转成 base64 落到同目录，页面用 XHR 读回来再交给 pdf.js。
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  Linking,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ExternalLink, Share2 } from 'lucide-react-native';
import * as Sharing from 'expo-sharing';
import { useStatusBarStyle } from '@/shared/hooks/useStatusBarStyle';
import { useResponsive } from '@/shared/hooks/useResponsive';
import { RootStackParamList, RootNav } from '@/app/navigation/types';
import { colors, fontSize, spacing } from '@/shared/theme/theme';

type Route = RouteProp<RootStackParamList, 'PdfReader'>;

/** 页面上跑的小程序：按屏宽铺满、滚到哪渲染哪，别一次画一百多页 */
function viewerHtml(libUri: string, workerUri: string, dataFile: string, maxCss: number) {
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=6,user-scalable=yes">
<style>
  html,body{margin:0;padding:0;background:#eef0f4;-webkit-text-size-adjust:100%;}
  /* 平板上页面不跟着屏宽涨，收到一页纸的宽度后居中 */
  #pages{max-width:${maxCss}px;margin:0 auto;padding:8px 8px 44px;}
  .pg{position:relative;margin:0 auto 10px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.10);}
  .pg canvas{display:block;width:100%;height:auto;}
  .ph{position:absolute;left:0;right:0;top:0;bottom:0;display:flex;align-items:center;
      justify-content:center;color:#b6bcc8;font:13px -apple-system,sans-serif;}
  #hud{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.94);
       border-top:1px solid #e2e5ea;color:#5b6472;font:12px -apple-system,sans-serif;
       text-align:center;padding:7px 0;}
</style>
</head><body>
<div id="pages"></div>
<div id="hud">正在载入…</div>
<script>
/*
 * 老设备的 WebView 是 Chrome 91（雷电模拟器就是），缺 Array.prototype.at，
 * 而 pdf.js 的 worker 里用了它——不补这两行，worker 会直接报
 * 「Setting up fake worker failed」。
 */
(function () {
  function at(n) {
    n = Math.trunc(n) || 0;
    if (n < 0) n += this.length;
    if (n < 0 || n >= this.length) return undefined;
    return this[n];
  }
  [Array.prototype, String.prototype].forEach(function (p) {
    if (!p.at) Object.defineProperty(p, 'at', { value: at, configurable: true, writable: true });
  });
  var TA = Object.getPrototypeOf(Uint8Array.prototype);
  if (TA && !TA.at) Object.defineProperty(TA, 'at', { value: at, configurable: true, writable: true });
})();
</script>
<script>
(function () {
  var hud = document.getElementById('hud');
  var host = document.getElementById('pages');
  var URI_A = ${JSON.stringify(libUri)};
  var URI_B = ${JSON.stringify(workerUri)};

  var doc = null;
  var boxes = [];
  /** 每页的绘制状态：0 未画 / 'busy' 正在画 / 1 已画 */
  var state = {};
  var dpr = Math.min(3, window.devicePixelRatio || 1);
  var width = Math.max(280, Math.min(document.documentElement.clientWidth, ${maxCss}) - 16);
  var current = 1;

  /*
   * 出图精度：画布像素 = CSS 像素 × dpr × BASE_Q。
   * 手机上是 344×2×2，一张 A4 出来 1376×1946，捏合放大到 4 倍
   * 仍然是一比一甚至过采样，字不会发虚；再翻倍就只是白吃内存
   * （一张 A4 会到四千万像素，渲染进程直接扛不住）。
   */
  var BASE_Q = 2;
  var MAX_W = 2600;
  var MAX_H = 3600;

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb(true); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  /*
   * 两个资源谁是谁不能写死：打包后文件被重命名过，顺序还可能和代码里相反。
   * 先试 A，拿到 pdfjsLib 就用它当主库、另一个当 worker；否则反过来。
   */
  loadScript(URI_A, function () {
    if (window.pdfjsLib) return boot(URI_A, URI_B);
    loadScript(URI_B, function () {
      if (window.pdfjsLib) boot(URI_B, URI_A);
      else hud.textContent = '阅读组件没能加载';
    });
  });

  function boot(libSrc, workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    start();
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function start() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', ${JSON.stringify(dataFile)}, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function () {
      var buf = xhr.response;
      if (buf && buf.byteLength) return parse(new Uint8Array(buf));
      /*
       * 个别 WebView 对 file:// 的 arraybuffer 支持不完整，退回 base64。
       * 注意 responseType 不是 text 时读 responseText 会抛 InvalidStateError。
       */
      var text = '';
      try { text = xhr.responseText || ''; } catch (e) { text = ''; }
      var comma = text.indexOf(',');
      if (text.slice(0, 5) === 'data:' && comma > 0) text = text.slice(comma + 1);
      if (!text) return fail(new Error('文件读取失败'));
      parse(b64ToBytes(text));
    };
    xhr.onerror = function () { fail(new Error('文件读取失败')); };
    xhr.send(null);
  }

  function parse(bytes) {
    try {
      pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise.then(ready).catch(fail);
    } catch (e) { fail(e); }
  }

  function fail(e) {
    hud.textContent = '打不开这个文件：' + ((e && e.message) || e);
  }

  function ready(d) {
    doc = d;
    hud.textContent = '1 / ' + d.numPages;
    for (var i = 1; i <= d.numPages; i++) {
      var box = document.createElement('div');
      box.className = 'pg';
      box.setAttribute('data-page', i);
      box.style.height = Math.round(width * 1.414) + 'px';
      var tip = document.createElement('div');
      tip.className = 'ph';
      tip.textContent = i;
      box.appendChild(tip);
      host.appendChild(box);
      boxes.push(box);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    /*
     * 用轮询补画，而不是 IntersectionObserver：画布会被释放，而观察者
     * 只在「进出视口」那一瞬间回调一次，释放之后停在原地就再也不会重画，
     * 屏幕上会一直留白（这正是上一版出现的症状）。600ms 对着可视范围
     * 复查一遍，代价可以忽略，任何失败状态下一轮都能自愈。
     */
    scheduleTick();
    setInterval(scheduleTick, 600);
  }

  /** 丢掉画布只留占位卡；高度要保住，否则滚动条会跟着跳 */
  function release(box, n) {
    if (state[n] !== 1) return;
    state[n] = 0;
    var h = box.style.height;
    while (box.firstChild) box.removeChild(box.firstChild);
    var tip = document.createElement('div');
    tip.className = 'ph';
    tip.textContent = n;
    box.appendChild(tip);
    box.style.height = h;
  }

  function draw(box, n) {
    if (state[n] === 'busy' || state[n] === 1) return;
    state[n] = 'busy';
    doc.getPage(n).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = (width / base.width) * dpr * BASE_Q;
      var vp = page.getViewport({ scale: scale });
      /* 超大页（横版图册之类）别把渲染进程撑爆，超了就整体缩回来 */
      var fit = Math.min(1, MAX_W / vp.width, MAX_H / vp.height);
      if (fit < 1) {
        scale *= fit;
        vp = page.getViewport({ scale: scale });
      }
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      /* 高度按画布宽高比反推，写死 1.414 遇到横版页会错位 */
      box.style.height = Math.round((width * vp.height) / vp.width) + 'px';
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(canvas);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
        .then(function () { state[n] = 1; });
    }).catch(function () {
      /* 画失败退回未画，下一轮 tick 会重试，不会永久留白 */
      state[n] = 0;
    });
  }

  function tick() {
    if (!doc) return;
    var top = window.scrollY;
    var bot = top + window.innerHeight;
    var first = 0;
    var last = 0;
    for (var i = 0; i < boxes.length; i++) {
      var t = boxes[i].offsetTop;
      if (t + boxes[i].offsetHeight > top && t < bot) {
        if (!first) first = i + 1;
        last = i + 1;
      }
    }
    if (!first) {
      first = current;
      last = current;
    }
    var from = Math.max(1, first - 1);
    var to = Math.min(doc.numPages, last + 1);
    for (var n = from; n <= to; n++) draw(boxes[n - 1], n);
    /* 可视范围上下各留两页，其余放掉，长文档才不会一直涨内存 */
    for (var m = 1; m <= doc.numPages; m++) {
      if (m < first - 2 || m > last + 2) release(boxes[m - 1], m);
    }
  }

  var ticking = false;
  function scheduleTick() {
    if (ticking) return;
    ticking = true;
    setTimeout(function () {
      ticking = false;
      tick();
    }, 100);
  }

  function onScroll() {
    if (!doc) return;
    var mid = window.scrollY + window.innerHeight * 0.45;
    for (var i = 0; i < boxes.length; i++) {
      var t = boxes[i].offsetTop;
      if (mid >= t && mid < t + boxes[i].offsetHeight) {
        if (current !== i + 1) {
          current = i + 1;
          hud.textContent = current + ' / ' + doc.numPages;
        }
        break;
      }
    }
    scheduleTick();
  }
})();
</script>
</body></html>`;
}

export function PdfReaderScreen() {
  const route = useRoute<Route>();
  const nav = useNavigation<RootNav>();
  const insets = useSafeAreaInsets();
  const r = useResponsive();
  useStatusBarStyle(false);

  /** 一页纸在平板上也不该超过这个宽度，否则字大得像海报 */
  const pageCssW = Math.min(r.readMax, 900);

  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  const title = route.params.title || 'PDF';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setProgress('正在准备文件…');
        const dir = new Directory(Paths.cache, 'pdfview');
        if (!dir.exists) dir.create({ idempotent: true });

        /*
         * pdf.js 本体随包发布，读取路径即可，不用联网。
         * 这里必须是字面量 require —— Metro 在打包时要静态解析资源路径，
         * 写成 import 或用变量都会让资源打进不来。
         */
        /* eslint-disable @typescript-eslint/no-require-imports */
        const lib = Asset.fromModule(require('../assets/pdfjs/pdf.min.txt'));
        const worker = Asset.fromModule(require('../assets/pdfjs/pdf.worker.min.txt'));
        /* eslint-enable @typescript-eslint/no-require-imports */
        await lib.downloadAsync();
        await worker.downloadAsync();
        const libUri = lib.localUri || lib.uri;
        const workerUri = worker.localUri || worker.uri;
        if (!libUri || !workerUri) throw new Error('阅读组件缺失');

        /*
         * 直接把 PDF 拷到缓存目录，而不是转 base64：一篇 13MB 的论文
         * 转成 base64 会变成 17MB 的字符串，读写和解析都要多绕一圈，
         * 低配机上很容易被内存打死。同一目录下 XHR 就能按二进制读回来。
         */
        setProgress('正在准备文件…');
        const dataFile = new File(dir, 'doc.pdf');
        if (dataFile.exists) dataFile.delete();
        await FileSystemLegacy.copyAsync({ from: route.params.uri, to: dataFile.uri });

        const htmlFile = new File(dir, 'viewer.html');
        if (htmlFile.exists) htmlFile.delete();
        htmlFile.create();
        htmlFile.write(viewerHtml(libUri, workerUri, dataFile.uri, pageCssW));

        if (alive) {
          setProgress('');
          setHtmlUri(htmlFile.uri);
        }
      } catch (e: any) {
        if (alive) {
          setProgress('');
          setError(e?.message || '文件读取失败');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [route.params.uri, pageCssW]);

  const share = async () => {
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('系统分享不可用');
      await Sharing.shareAsync(route.params.uri, {
        mimeType: 'application/pdf',
        dialogTitle: '分享 PDF',
      });
    } catch (e: any) {
      Alert.alert('分享失败', e?.message || '未知错误');
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => nav.goBack()} hitSlop={10}>
          <ArrowLeft size={22} color={colors.text} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable onPress={share} hitSlop={10}>
          <Share2 size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL(route.params.uri).catch(() => undefined)}
          hitSlop={10}
          style={{ marginLeft: spacing.md }}
        >
          <ExternalLink size={18} color={colors.textSecondary} strokeWidth={2} />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.errTitle}>这本书没能打开</Text>
          <Text style={styles.errDesc}>{error}</Text>
          <Pressable onPress={share} style={styles.errBtn}>
            <Text style={styles.errBtnText}>用其他应用打开</Text>
          </Pressable>
        </View>
      ) : htmlUri ? (
        <WebView
          source={{ uri: htmlUri }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          javaScriptEnabled
          domStorageEnabled
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          style={styles.web}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loading}>{progress || '正在打开…'}</Text>
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
  title: { flex: 1, fontSize: fontSize.body, fontWeight: '600', color: colors.text },
  web: { flex: 1, backgroundColor: '#eef0f4' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  loading: { marginTop: spacing.md, fontSize: fontSize.small, color: colors.textSecondary },
  errTitle: { fontSize: fontSize.bodyLg, fontWeight: '700', color: colors.text },
  errDesc: {
    marginTop: spacing.sm,
    fontSize: fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errBtnText: { color: colors.textInverse, fontSize: fontSize.body, fontWeight: '700' },
});

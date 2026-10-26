const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/*
 * pdf.js 的两个文件直接当资源打包（assets/pdfjs/*.txt）。
 * 它们是要在 WebView 里执行的脚本，不能走 Metro 的 JS 处理链路，
 * 所以故意用 .txt 后缀，让 Metro 只把它当二进制资源拷进包里。
 */
if (!config.resolver.assetExts.includes('txt')) {
  config.resolver.assetExts.push('txt');
}

module.exports = config;

/*
 * ESLint 扁平配置（ESLint 9 + eslint-config-expo）。
 *
 * 用 Expo 官方那套规则，不自己另起炉灶：它已经把 react-hooks、
 * react-native、import 顺序这些最容易出错的项配好了。
 *
 * 忽略项只放「不是应用代码」的目录：构建产物、原生工程、
 * 以及 scripts/ 下那些一次性的调试脚本（写法和业务代码不一样）。
 */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', 'android/**', 'ios/**', 'scripts/**', 'docs/**', 'node_modules/**'],
  },
  {
    rules: {
      /* 中文注释里常出现全角标点，和英文混排时 this 别被误判 */
      'react/no-unescaped-entities': 'off',
      /*
       * 这两条是 React Compiler 用的规则，本项目没启用编译器，
       * 而数据流是命令式的（拉取完 setState、事件回调里取时间戳），
       * 规则会把正常写法判成错误，属于噪声，关掉。
       */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);

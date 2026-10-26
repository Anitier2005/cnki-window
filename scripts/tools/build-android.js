/*
 * 打 Android release 包。
 *
 * 两个坑写死在脚本里，省得每次手动补：
 * 1) gradle 需要 JDK 17（且是完整 JDK，不是 JRE），否则会报
 *    "Toolchain ... does not provide JAVA_COMPILER"；
 * 2) 默认只出 arm64 —— 全 ABI 编一遍要十几分钟，日常验证没必要，
 *    要全架构就自己改 android/gradle.properties。
 *
 * JAVA_HOME 从环境变量取，没设置就直接报错，不猜路径。
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '../..');
const androidDir = path.join(root, 'android');

if (!fs.existsSync(androidDir)) {
  console.error('找不到 android/，先执行 npx expo prebuild 生成原生工程');
  process.exit(1);
}

if (!process.env.JAVA_HOME) {
  console.error(
    '请先设置 JAVA_HOME 指向 JDK 17 目录，例如：\n' +
      '  Windows:  $env:JAVA_HOME="C:\\path\\to\\jdk-17"\n' +
      '  macOS/Linux: export JAVA_HOME=/path/to/jdk-17',
  );
  process.exit(1);
}

const isWin = process.platform === 'win32';
const r = spawnSync(isWin ? 'gradlew.bat' : './gradlew', ['assembleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});

process.exit(r.status === null ? 1 : r.status);

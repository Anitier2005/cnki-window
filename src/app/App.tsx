import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/core/bridge/SessionProvider';
import { RootNavigator } from '@/app/navigation/RootNavigator';
import { warmupStorage } from '@/core/storage/store';
import { colors } from '@/shared/theme/theme';

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};

export default function App() {
  useEffect(() => {
    // 预热本地存储，避免首屏列表出现空态闪烁
    warmupStorage().catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      {/*
        SessionProvider 必须在 NavigationContainer 外层：
        它持有一个常驻 WebView，用来维持知网会话（含 IP 登录后的 cookie），
        页面切换时这个 WebView 不能被卸载，否则会话与验证状态会一起丢。
      */}
      <SessionProvider>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

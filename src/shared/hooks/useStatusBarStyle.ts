import { useCallback } from 'react';
import { StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * 按页面切换状态栏文字颜色。
 *
 * 首页顶部是深蓝底，需要浅色文字；其余页面浅底，需要深色文字。
 * 用 useFocusEffect 而不是全局 StatusBar 组件，页面来回切换时颜色才不会错乱。
 */
export function useStatusBarStyle(light: boolean) {
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle(light ? 'light-content' : 'dark-content', true);
    }, [light]),
  );
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyInitialTheme, setTheme } from './theme';
import { Theme } from './theme.types';

/**
 * Tests for the theme module: a thin wrapper around the `dark` class on the
 * `<html>` element and `localStorage.theme`.
 */
describe('theme module', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('applyInitialTheme adds the dark class when localStorage.theme is unset', () => {
    applyInitialTheme();
    expect(document.documentElement.classList.contains('dark')).toEqual(true);
  });

  it('applyInitialTheme removes the dark class when localStorage.theme is light', () => {
    window.localStorage.setItem('theme', 'light');
    document.documentElement.classList.add('dark');
    applyInitialTheme();
    expect(document.documentElement.classList.contains('dark')).toEqual(false);
  });

  it('setTheme(light) removes the dark class and persists light to localStorage', () => {
    document.documentElement.classList.add('dark');
    setTheme(Theme.Light);
    expect({
      dark: document.documentElement.classList.contains('dark'),
      stored: window.localStorage.getItem('theme'),
    }).toEqual({ dark: false, stored: 'light' });
  });

  it('setTheme(dark) adds the dark class and persists dark to localStorage', () => {
    setTheme(Theme.Dark);
    expect({
      dark: document.documentElement.classList.contains('dark'),
      stored: window.localStorage.getItem('theme'),
    }).toEqual({ dark: true, stored: 'dark' });
  });
});

import { PALETTES, type Palette } from '@car-porter/core';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';
export type { Palette };

const STORAGE_KEY = 'car-porter.theme';
const PALETTE_KEY = 'car-porter.palette';
const DEFAULT_THEME: Theme = 'dark';
const DEFAULT_PALETTE: Palette = 'champagne';

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the choice still applies for this session
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStored(STORAGE_KEY, ['dark', 'light'], DEFAULT_THEME));
  const [palette, setPalette] = useState<Palette>(() => readStored(PALETTE_KEY, PALETTES, DEFAULT_PALETTE));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    store(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    store(PALETTE_KEY, palette);
  }, [palette]);

  return <ThemeContext value={{ theme, setTheme, palette, setPalette }}>{children}</ThemeContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

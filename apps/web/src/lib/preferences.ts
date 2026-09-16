import type { Settings } from '@car-porter/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/features/lot/hooks';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type Ui = Settings['ui'];

/**
 * Language and theme apply instantly from localStorage and are saved in the settings API, which
 * wins on load (so a fresh browser gets the saved preferences).
 */
export function useSyncPreferences() {
  const { i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const ui = useSettings().data?.ui;

  useEffect(() => {
    if (!ui) return;
    if (i18n.language !== ui.language) void i18n.changeLanguage(ui.language);
    if (theme !== ui.theme) setTheme(ui.theme);
    // only react to server values; local changes update the cached settings first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui?.language, ui?.theme]);
}

export function useUpdatePreferences() {
  const { i18n } = useTranslation();
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (ui: Partial<Ui>) => api.updateSettings({ ui }),
    onSuccess: (settings) => queryClient.setQueryData(['settings'], settings),
  });

  const update = (ui: Partial<Ui>) => {
    queryClient.setQueryData<Settings>(
      ['settings'],
      (prev) => prev && { ...prev, ui: { ...prev.ui, ...ui } },
    );
    if (ui.language) void i18n.changeLanguage(ui.language);
    if (ui.theme) setTheme(ui.theme);
    save.mutate(ui);
  };

  return {
    setLanguage: (language: Ui['language']) => update({ language }),
    setTheme: (theme: Ui['theme']) => update({ theme }),
  };
}

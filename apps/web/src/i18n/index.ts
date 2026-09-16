import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bg from './locales/bg.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['en', 'bg'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'car-porter.language';

function readStoredLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'bg' ? 'bg' : 'en';
  } catch {
    return 'en';
  }
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // storage unavailable
  }
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, bg: { translation: bg } },
  lng: readStoredLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;

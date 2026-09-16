import { Languages, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { useUpdatePreferences } from '@/lib/preferences';
import { useTheme } from '@/lib/theme';

export function HeaderControls() {
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const preferences = useUpdatePreferences();

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('header.language')}>
            <Languages />
            <span className="uppercase">{i18n.language}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={i18n.language}
            onValueChange={(lng) => preferences.setLanguage(lng as Language)}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <DropdownMenuRadioItem key={lng} value={lng}>
                {t(`language.${lng}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" aria-label={t('header.toggleTheme')} onClick={() => preferences.setTheme(theme === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </div>
  );
}

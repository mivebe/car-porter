import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout/page-header';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <PageHeader title={t('pages.settings.title')} description={t('pages.settings.description')} />
  );
}

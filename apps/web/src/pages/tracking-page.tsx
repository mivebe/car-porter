import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/layout/page-header';

export function TrackingPage() {
  const { t } = useTranslation();
  return (
    <PageHeader title={t('pages.tracking.title')} description={t('pages.tracking.description')} />
  );
}

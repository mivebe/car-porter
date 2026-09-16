import { checkVin, effectiveVin } from '@car-porter/core';
import { AlertTriangle, CheckCircle2, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface VinFieldProps {
  lotVin: string | null;
  override: string | null;
  onCommit: (vin: string | null) => void;
}

/** Shows the lot VIN and lets the user paste the full VIN read from the photos. */
export function VinField({ lotVin, override, onCommit }: VinFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? override ?? '';
  const check = text ? checkVin(text) : null;
  const effective = effectiveVin(lotVin, draft ?? override);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim() ? checkVin(draft).normalized : null;
    if (next !== override) onCommit(next);
    setDraft(null);
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor="vin-override" className="flex items-center gap-2">
        <ScanLine className="size-4" />
        {t('lotDetail.vinOverride')}
      </Label>
      <Input
        id="vin-override"
        className="font-mono uppercase"
        placeholder={lotVin ?? t('lotDetail.vinPlaceholder')}
        maxLength={20}
        value={text}
        aria-invalid={!!check && !check.valid}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="vin-status">
        {check && !check.valid && (
          <>
            <AlertTriangle className="size-3.5 text-destructive" />
            {t('lotDetail.vinInvalid', { length: check.normalized.length })}
          </>
        )}
        {check?.valid && check.checkDigitValid === false && (
          <>
            <AlertTriangle className="size-3.5 text-warning" />
            {t('lotDetail.vinCheckDigit')}
          </>
        )}
        {check?.valid && check.checkDigitValid && (
          <>
            <CheckCircle2 className="size-3.5 text-success" />
            {t('lotDetail.vinValid')}
          </>
        )}
        {!check && (effective ? t('lotDetail.vinUsingLot') : t('lotDetail.vinMasked'))}
      </p>
    </div>
  );
}

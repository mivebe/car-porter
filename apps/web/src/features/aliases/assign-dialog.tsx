import { useQuery } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/features/search/combobox';
import { SourceBadge } from '@/features/search/source-badge';
import { api, type AliasEntry } from '@/lib/api';
import { effectiveTargets } from './alias-hooks';
import { cn } from '@/lib/utils';

interface AssignDialogProps {
  /** Site names to assign; for models they share one make. Empty = closed. */
  entries: AliasEntry[];
  onClose: () => void;
  onSave: (targets: string[]) => Promise<unknown>;
  saving: boolean;
}

export function AssignDialog({ entries, onClose, onSave, saving }: AssignDialogProps) {
  const first = entries[0];
  return (
    <Dialog open={!!first} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {first && (
          // keyed so each opening starts from the entries' current targets
          <AssignForm
            key={entries.map((e) => `${e.source}:${e.externalName}`).join('|')}
            entries={entries}
            onClose={onClose}
            onSave={onSave}
            saving={saving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({ entries, onClose, onSave, saving }: AssignDialogProps) {
  const { t } = useTranslation();
  const first = entries[0]!;
  const isModel = first.kind === 'model';
  const [targets, setTargets] = useState<string[]>(effectiveTargets(first));

  const makes = useQuery({ queryKey: ['catalog', 'makes'], queryFn: api.makes, staleTime: Infinity, enabled: !isModel });
  const models = useQuery({
    queryKey: ['catalog', 'models', first.make.toLowerCase()],
    queryFn: () => api.models(first.make),
    enabled: isModel,
    staleTime: Infinity,
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(isModel ? 'aliases.assign.titleModel' : 'aliases.assign.titleMake')}</DialogTitle>
        <DialogDescription>
          {isModel ? t('aliases.assign.descriptionModel', { make: first.make }) : t('aliases.assign.descriptionMake')}
        </DialogDescription>
      </DialogHeader>

      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" data-testid="assign-entries">
        {entries.map((e) => (
          <span key={`${e.source}:${e.externalName}`} className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
            <SourceBadge source={e.source} />
            <span className="font-mono">{e.externalName}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="assign-target">{t(isModel ? 'aliases.assign.models' : 'aliases.assign.make')}</Label>
        {isModel ? (
          <ModelPicker
            options={(models.data?.items ?? []).map((m) => m.name)}
            loading={models.isLoading}
            value={targets}
            onChange={setTargets}
          />
        ) : (
          <Combobox
            id="assign-target"
            ariaLabel={t('aliases.assign.make')}
            value={targets[0] ?? ''}
            onChange={(make) => setTargets([make])}
            options={(makes.data?.items ?? []).map((m) => m.name)}
            loading={makes.isLoading}
            placeholder={t('search.selectMake')}
            searchPlaceholder={t('search.searchMake')}
            emptyText={t('search.noOptions')}
            customOptionLabel={(typed) => t('aliases.assign.createNew', { value: typed })}
          />
        )}
        {first.auto.targets.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('aliases.assign.suggestion', { targets: first.auto.targets.join(', ') })}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('aliases.assign.cancel')}
        </Button>
        <Button disabled={targets.length === 0 || saving} onClick={() => void onSave(targets).then(onClose)}>
          {t('aliases.assign.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

interface ModelPickerProps {
  options: string[];
  loading: boolean;
  value: string[];
  onChange: (value: string[]) => void;
}

/** Multi-select over the make's models; typing a name that isn't listed creates it. */
function ModelPicker({ options, loading, value, onChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const trimmed = typed.trim();
  const listed = [...new Set([...value, ...options])];
  const known = listed.some((o) => o.toLowerCase() === trimmed.toLowerCase());
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);

  return (
    <div className="grid gap-2">
      <div className="flex min-h-7 flex-wrap gap-1.5" data-testid="assign-selected">
        {value.length === 0 && <span className="text-sm text-muted-foreground">{t('aliases.assign.noneSelected')}</span>}
        {value.map((name) => (
          <Badge key={name} variant="secondary" className="gap-1">
            {name}
            <button type="button" aria-label={t('aliases.assign.remove', { name })} onClick={() => toggle(name)}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Command className="rounded-md border">
        <CommandInput id="assign-target" placeholder={t('search.searchModel')} value={typed} onValueChange={setTyped} />
        <CommandList className="max-h-56">
          <CommandEmpty>{loading ? t('aliases.loading') : t('search.noOptions')}</CommandEmpty>
          {trimmed && !known && (
            <CommandGroup>
              <CommandItem
                value={`__custom__${trimmed}`}
                onSelect={() => {
                  onChange([...value, trimmed]);
                  setTyped('');
                }}
              >
                <Plus className="size-4" />
                {t('aliases.assign.createNew', { value: trimmed })}
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup>
            {listed.map((name) => (
              <CommandItem key={name} value={name} onSelect={() => toggle(name)}>
                <Check className={cn('size-4', value.includes(name) ? 'opacity-100' : 'opacity-0')} />
                {name}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

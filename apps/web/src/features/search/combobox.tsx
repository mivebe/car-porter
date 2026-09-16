import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  /** Label for the "use what I typed" item when the value isn't in the list. */
  customOptionLabel?: (typed: string) => string;
  loading?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  customOptionLabel,
  loading,
  disabled,
  ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const exact = options.some((o) => o.toLowerCase() === typed.trim().toLowerCase());

  const select = (next: string) => {
    onChange(next);
    setTyped('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          {loading ? <Loader2 className="animate-spin opacity-60" /> : <ChevronsUpDown className="opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={typed} onValueChange={setTyped} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {customOptionLabel && typed.trim() && !exact && (
              <CommandGroup>
                <CommandItem value={`__custom__${typed}`} onSelect={() => select(typed.trim())}>
                  {customOptionLabel(typed.trim())}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} value={option} onSelect={() => select(option)}>
                  <Check className={cn('size-4', value === option ? 'opacity-100' : 'opacity-0')} />
                  {option}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

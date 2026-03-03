'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ checked = false, onCheckedChange, disabled, id, className }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        id={id}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          'h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'flex items-center justify-center transition-colors',
          checked ? 'bg-primary text-primary-foreground' : 'bg-background',
          className
        )}
      >
        {checked && <Check className="h-3 w-3" />}
      </button>
    );
  }
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };

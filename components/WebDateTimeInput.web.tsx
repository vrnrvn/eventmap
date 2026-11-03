import { useState } from 'react';
import { Colors, Typography, BorderRadius } from '@/constants/theme';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@/utils/eventDatetime';
import { parseRecurrenceEndDate, toRecurrenceEndDate } from '@/utils/recurrence';
import type { WebDateTimeInputProps } from './WebDateTimeInput';

export type { WebDateTimeInputProps };

/**
 * Web date/time field. `@react-native-community/datetimepicker` has no web
 * implementation (it renders null and warns), so the create/edit forms use
 * the browser's native `datetime-local` / `date` controls here. Values
 * round-trip in local time, matching how the native pickers produce Dates.
 */
export function WebDateTimeInput({
  value,
  onChange,
  minimumDate,
  maximumDate,
  accessibilityLabel,
  mode = 'datetime',
}: WebDateTimeInputProps) {
  const format = mode === 'date' ? toRecurrenceEndDate : toDateTimeLocalValue;
  const parse = mode === 'date' ? parseRecurrenceEndDate : fromDateTimeLocalValue;
  // Keep the raw text while the user is mid-edit so a transiently invalid
  // value (cleared field) doesn't snap back under their cursor.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? format(value);

  return (
    <input
      type={mode === 'date' ? 'date' : 'datetime-local'}
      aria-label={accessibilityLabel}
      value={shown}
      min={minimumDate ? format(minimumDate) : undefined}
      max={maximumDate ? format(maximumDate) : undefined}
      step={mode === 'date' ? undefined : 60}
      onChange={(e) => {
        const text = e.currentTarget.value;
        const parsed = parse(text);
        if (parsed) {
          setDraft(null);
          onChange(parsed);
        } else {
          setDraft(text);
        }
      }}
      onBlur={() => setDraft(null)}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 12px',
        fontSize: Typography.sizes.md,
        fontFamily: 'inherit',
        color: Colors.text.primary,
        backgroundColor: Colors.surface,
        border: `1px solid ${Colors.border.light}`,
        borderRadius: BorderRadius.md,
        outlineColor: Colors.primary,
      }}
    />
  );
}

/**
 * Native stub. The web implementation lives in WebDateTimeInput.web.tsx and
 * is picked by Metro's platform resolution; native screens render the
 * community DateTimePicker instead, so this never shows anything.
 */
export type WebDateTimeInputProps = {
  value: Date;
  onChange: (next: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  accessibilityLabel?: string;
  /** `datetime` (default) renders a datetime-local input; `date` a date-only one. */
  mode?: 'datetime' | 'date';
};

export function WebDateTimeInput(_props: WebDateTimeInputProps): null {
  return null;
}

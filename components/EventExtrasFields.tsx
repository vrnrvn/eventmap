import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Input } from '@/components/Input';
import { alpha, BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import type { AgeRestriction, EventVisibility } from '@/types/database';
import { a11yState } from '@/utils/accessibility';

export type EventExtrasDraft = {
  visibility: EventVisibility;
  ticketUrl: string;
  priceLabel: string;
  ageRestriction: AgeRestriction;
  accessibilityNotes: string;
  whatToBring: string;
};

export const EMPTY_EXTRAS: EventExtrasDraft = {
  visibility: 'public',
  ticketUrl: '',
  priceLabel: '',
  ageRestriction: 'none',
  accessibilityNotes: '',
  whatToBring: '',
};

export const AGE_OPTIONS: { value: AgeRestriction; label: string }[] = [
  { value: 'none', label: 'All ages' },
  { value: '18+', label: '18+' },
  { value: '21+', label: '21+' },
];

/** Validation shared by create and edit. Returns field → message. */
export function validateExtras(e: EventExtrasDraft): Partial<Record<keyof EventExtrasDraft, string>> {
  const errors: Partial<Record<keyof EventExtrasDraft, string>> = {};
  const ticket = e.ticketUrl.trim();
  if (ticket && !/^https?:\/\/\S+$/i.test(ticket)) errors.ticketUrl = 'Enter a full link starting with http:// or https://';
  if (ticket.length > 500) errors.ticketUrl = 'Link is too long';
  if (e.priceLabel.trim().length > 60) errors.priceLabel = 'Keep the price under 60 characters';
  if (e.accessibilityNotes.trim().length > 500) errors.accessibilityNotes = 'Keep notes under 500 characters';
  if (e.whatToBring.trim().length > 500) errors.whatToBring = 'Keep this under 500 characters';
  return errors;
}

type Props = {
  value: EventExtrasDraft;
  onChange: (next: EventExtrasDraft) => void;
  errors?: Partial<Record<keyof EventExtrasDraft, string>>;
  /** The create/edit screens differ in how rows are framed; this only renders the fields. */
  disabled?: boolean;
};

/**
 * "More options" fields shared by Create and Edit (plan §4C): visibility,
 * tickets/price, age restriction, accessibility notes, what to bring. All
 * optional; the server stores empty values as NULL.
 */
export function EventExtrasFields({ value, onChange, errors, disabled }: Props) {
  const set = <K extends keyof EventExtrasDraft>(key: K, v: EventExtrasDraft[K]) => onChange({ ...value, [key]: v });
  const unlisted = value.visibility === 'unlisted';
  return (
    <View style={styles.wrap}>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchTitle}>Unlisted</Text>
          <Text style={styles.switchDesc}>
            {unlisted
              ? 'Hidden from Discover and search. Only people with the link can open it.'
              : 'Shown in Discover and search like any other event.'}
          </Text>
        </View>
        <Switch
          value={unlisted}
          onValueChange={(v) => set('visibility', v ? 'unlisted' : 'public')}
          disabled={disabled}
          accessibilityLabel="Unlisted event"
          accessibilityHint="Hide from Discover and search; share by link only"
          trackColor={{ false: Colors.border.medium, true: alpha(Colors.primary, 0.5) }}
          thumbColor={unlisted ? Colors.primary : Colors.background.secondary}
        />
      </View>

      <Input
        label="Tickets link (optional)"
        value={value.ticketUrl}
        onChangeText={(t) => set('ticketUrl', t)}
        placeholder="https://…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!disabled}
        error={errors?.ticketUrl}
      />
      <Input
        label="Price (optional)"
        value={value.priceLabel}
        onChangeText={(t) => set('priceLabel', t.slice(0, 60))}
        placeholder="Free · €12 at the door · From $20"
        editable={!disabled}
        error={errors?.priceLabel}
      />

      <Text style={styles.fieldLabel}>Age</Text>
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {AGE_OPTIONS.map((opt) => {
          const selected = value.ageRestriction === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => set('ageRestriction', opt.value)}
              disabled={disabled}
              accessibilityRole="radio"
              {...a11yState({ selected })}
              accessibilityLabel={`Age: ${opt.label}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Input
        label="Accessibility (optional)"
        value={value.accessibilityNotes}
        onChangeText={(t) => set('accessibilityNotes', t.slice(0, 500))}
        placeholder="Step-free entrance, accessible toilets, quiet room…"
        multiline
        editable={!disabled}
        error={errors?.accessibilityNotes}
      />
      <Input
        label="What to bring (optional)"
        value={value.whatToBring}
        onChangeText={(t) => set('whatToBring', t.slice(0, 500))}
        placeholder="ID, cash for the bar, a yoga mat…"
        multiline
        editable={!disabled}
        error={errors?.whatToBring}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  switchText: {
    flex: 1,
  },
  switchTitle: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  switchDesc: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border.light,
    backgroundColor: Colors.surface,
  },
  chipSelected: {
    borderColor: alpha(Colors.primary, 0.4),
    backgroundColor: Colors.primarySoft,
  },
  chipText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.secondary,
  },
  chipTextSelected: {
    color: Colors.primary,
  },
});

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Input } from '@/components/Input';
import { alpha, BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import { choiceA11y } from '@/utils/accessibility';
import { applyPriceChoice, priceChoice, showsPriceInput, type PriceChoice } from '@/utils/eventPrice';

type Props = {
  priceLabel: string;
  ticketUrl: string;
  onChange: (next: { priceLabel: string; ticketUrl: string }) => void;
  errors?: { priceLabel?: string; ticketUrl?: string };
  disabled?: boolean;
};

const CHOICES: { value: PriceChoice; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

/**
 * Price and tickets as their own section of Create and Edit (review C3/C4).
 *
 * They used to sit behind the collapsed "More options" row, one tap deeper
 * than "Max attendees", so most events published with no price at all — the
 * attribute attendees compare on hardest. The Free chip writes the canonical
 * label in one tap (`utils/eventPrice`); Paid opens the free-text amount.
 * The stored field is still `price_label` — a string — by design (D3).
 */
export function EventPriceFields({ priceLabel, ticketUrl, onChange, errors, disabled }: Props) {
  // Paid with nothing typed yet has an empty label; this keeps the chip
  // selected and the input open until an amount is entered.
  const [paidChosen, setPaidChosen] = useState(false);
  const choice = priceChoice(priceLabel, paidChosen);

  const pick = (next: PriceChoice) => {
    setPaidChosen(next === 'paid');
    onChange({ priceLabel: applyPriceChoice(priceLabel, next), ticketUrl });
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.fieldLabel}>Price</Text>
      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {CHOICES.map((opt) => {
          const selected = choice === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => pick(opt.value)}
              disabled={disabled}
              activeOpacity={0.8}
              {...choiceA11y(selected, `Price: ${opt.label}`)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showsPriceInput(priceLabel, paidChosen) ? (
        <Input
          label="Amount"
          value={priceLabel}
          onChangeText={(t) => onChange({ priceLabel: t.slice(0, 60), ticketUrl })}
          placeholder="€12 at the door · From $20"
          editable={!disabled}
          error={errors?.priceLabel}
          autoFocus={!priceLabel}
        />
      ) : choice === null ? (
        <Text style={styles.hint}>Optional — but it is the first thing people compare.</Text>
      ) : null}
      <Input
        label="Tickets link (optional)"
        value={ticketUrl}
        onChangeText={(t) => onChange({ priceLabel, ticketUrl: t })}
        placeholder="https://…"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!disabled}
        error={errors?.ticketUrl}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.xs,
  },
  fieldLabel: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.labelFontFamilies.medium,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  chip: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 18,
    alignItems: 'center',
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
  hint: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginBottom: Spacing.sm,
  },
});

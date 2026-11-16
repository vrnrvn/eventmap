import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bookmark } from '@/components/icons.generated';
import { Colors, FontScaleCaps, BorderRadius, Spacing, Typography } from '@/constants/theme';
import { a11yState } from '@/utils/accessibility';
import { joinActionFor, type CompareInput } from '@/utils/compare';

export type CompareActionHandlers = {
  onOpen: (id: string) => void;
  onJoin: (input: CompareInput) => void;
  onToggleSave: (input: CompareInput) => void;
};

type Props = CompareActionHandlers & {
  input: CompareInput;
  signedIn: boolean;
  busy: boolean;
  /** Compact for the table footer; roomier inside a card. */
  compact?: boolean;
};

/**
 * The per-column actions (plan §3.2): one primary — Join when one tap does
 * it, otherwise the event page's own label handing off to it — plus the
 * bookmark. Shared by the table footer and the cards so they can't disagree.
 */
export function CompareActions({ input, signedIn, busy, compact, onOpen, onJoin, onToggleSave }: Props) {
  const action = joinActionFor(input, signedIn);
  const disabled = busy || action.kind === 'going';
  const saved = !!input.userSaved;
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <TouchableOpacity
        style={[
          styles.primary,
          action.kind === 'join' && styles.primaryJoin,
          action.kind === 'going' && styles.primaryGoing,
        ]}
        onPress={() => (action.kind === 'join' ? onJoin(input) : action.kind === 'open' ? onOpen(input.id) : undefined)}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={
          action.kind === 'join'
            ? `Join ${input.title}`
            : action.kind === 'going'
              ? `You're going to ${input.title}`
              : `${action.label}: open ${input.title}`
        }
        {...a11yState({ disabled, busy })}
      >
        {busy ? (
          <ActivityIndicator size="small" color={action.kind === 'join' ? Colors.white : Colors.primary} />
        ) : (
          <Text
            maxFontSizeMultiplier={FontScaleCaps.control}
            style={[
              styles.primaryText,
              action.kind === 'join' && styles.primaryTextJoin,
              action.kind === 'going' && styles.primaryTextGoing,
            ]}
            numberOfLines={1}
          >
            {action.label}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.bookmark, saved && styles.bookmarkOn]}
        onPress={() => onToggleSave(input)}
        disabled={busy}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={saved ? `Remove ${input.title} from saved events` : `Save ${input.title}`}
        {...a11yState({ selected: saved, disabled: busy }, 'button')}
      >
        <Bookmark size={18} color={Colors.primary} fill={saved ? Colors.primary : 'transparent'} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowCompact: { gap: 6 },
  primary: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: Spacing.sm + 2,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryJoin: { backgroundColor: Colors.primary },
  primaryGoing: { borderColor: Colors.successSoft, backgroundColor: Colors.successSoft },
  primaryText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.bold,
    color: Colors.primary,
  },
  primaryTextJoin: { color: Colors.white },
  primaryTextGoing: { color: Colors.successText },
  bookmark: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  bookmarkOn: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
});

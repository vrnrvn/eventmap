import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Link2, Plus, X } from '@/components/icons.generated';
import { Colors, Spacing, Typography, BorderRadius } from '@/constants/theme';
import { MAX_EVENT_LINKS, normalizeLinkUrl, type EventLinkDraft } from '@/utils/eventLinks';

export { MAX_EVENT_LINKS, normalizeLinkUrl, type EventLinkDraft };

type Props = {
  links: EventLinkDraft[];
  onChange: (next: EventLinkDraft[]) => void;
  /** Per-row validation messages, keyed by row index. */
  errors?: Record<number, string>;
  maxLinks?: number;
};

/**
 * Ticket / RSVP / menu links for an event. The `event_links` table, service
 * and the detail screen's Links section already existed; this is the missing
 * authoring UI.
 */
export function EventLinksEditor({ links, onChange, errors, maxLinks = MAX_EVENT_LINKS }: Props) {
  const update = (index: number, patch: Partial<EventLinkDraft>) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  const remove = (index: number) => onChange(links.filter((_, i) => i !== index));

  const add = () => {
    if (links.length >= maxLinks) return;
    onChange([...links, { label: '', url: '' }]);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.hint}>
        Add a ticket page, menu or sign-up form. Shown as buttons on the event.
      </Text>

      {links.map((link, index) => (
        <View key={link.id ?? `new-${index}`} style={styles.row}>
          <View style={styles.rowHead}>
            <Link2 size={16} color={Colors.text.tertiary} />
            <TextInput
              value={link.label}
              onChangeText={(t) => update(index, { label: t })}
              placeholder="Label (e.g. Tickets)"
              placeholderTextColor={Colors.text.tertiary}
              style={styles.labelInput}
              maxLength={40}
              accessibilityLabel={`Link ${index + 1} label`}
            />
            <TouchableOpacity
              onPress={() => remove(index)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Remove link ${index + 1}`}
            >
              <X size={16} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>
          <TextInput
            value={link.url}
            onChangeText={(t) => update(index, { url: t })}
            placeholder="https://example.com/tickets"
            placeholderTextColor={Colors.text.tertiary}
            style={[styles.urlInput, errors?.[index] && styles.urlInputError]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            accessibilityLabel={`Link ${index + 1} address`}
          />
          {errors?.[index] ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {errors[index]}
            </Text>
          ) : null}
        </View>
      ))}

      {links.length < maxLinks ? (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={add}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Add a link"
        >
          <Plus size={16} color={Colors.primary} />
          <Text style={styles.addText}>Add link</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.maxText}>Up to {maxLinks} links.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.sm,
  },
  hint: {
    fontSize: Typography.sizes.xs,
    lineHeight: 16,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
  row: {
    gap: 6,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background.secondary,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  labelInput: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.semibold,
    paddingVertical: 4,
  },
  urlInput: {
    borderWidth: 1,
    borderColor: Colors.border.light,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    fontSize: Typography.sizes.sm,
    color: Colors.text.primary,
    fontFamily: Typography.fontFamilies.regular,
  },
  urlInputError: {
    borderColor: Colors.error,
  },
  errorText: {
    fontSize: Typography.sizes.xs,
    color: Colors.error,
    fontFamily: Typography.fontFamilies.medium,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
  },
  addText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontFamily: Typography.fontFamilies.semibold,
  },
  maxText: {
    fontSize: Typography.sizes.xs,
    color: Colors.text.tertiary,
    fontFamily: Typography.fontFamilies.regular,
  },
});

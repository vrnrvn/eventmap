import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, Search, X } from '@/components/icons.generated';
import { BorderRadius, Colors, Spacing, Typography } from '@/constants/theme';
import {
  getDeviceTimeZone,
  isValidTimeZone,
  searchTimeZones,
  timeZoneOptions,
  zoneDisplayLabel,
  type TimeZoneOption,
} from '@/utils/timezone';
import { a11yState } from '@/utils/accessibility';

type Props = {
  visible: boolean;
  value: string;
  /** Instant used to compute offsets shown in the list (defaults to now). */
  referenceDate?: Date;
  onSelect: (tz: string) => void;
  onClose: () => void;
};

/**
 * Searchable list of IANA zones for the event forms. Device zone and the
 * current value are pinned to the top; the rest is sorted by offset.
 */
export function TimeZonePicker({ visible, value, referenceDate, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  // Offsets only change at DST transitions; keying on the day is plenty and
  // keeps the (expensive) option list stable across renders.
  const referenceMs = referenceDate?.getTime() ?? Date.now();
  const referenceDay = Math.floor(referenceMs / 86_400_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reference = useMemo(() => new Date(referenceMs), [referenceDay]);
  const allOptions = useMemo(() => timeZoneOptions(reference), [reference]);
  const deviceTz = getDeviceTimeZone();

  const rows = useMemo(() => {
    const filtered = searchTimeZones(allOptions, query);
    if (query.trim()) {
      // A full id typed in that the runtime knows but the list lacks.
      const typed = query.trim();
      if (filtered.length === 0 && isValidTimeZone(typed)) {
        return [{ id: typed, label: zoneDisplayLabel(typed, reference), region: 'Other', offsetMinutes: 0 }];
      }
      return filtered;
    }
    const pinnedIds = Array.from(new Set([value, deviceTz].filter(Boolean)));
    const pinned = pinnedIds
      .map((id) => allOptions.find((o) => o.id === id))
      .filter((o): o is TimeZoneOption => !!o);
    return [...pinned, ...filtered.filter((o) => !pinnedIds.includes(o.id))];
  }, [allOptions, query, value, deviceTz, reference]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close time zone picker" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          <View style={styles.header}>
            <Text style={styles.title}>Time zone</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={22} color={Colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchRow}>
            <Search size={16} color={Colors.text.tertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search city, region or GMT offset"
              placeholderTextColor={Colors.text.disabled}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search time zones"
            />
          </View>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            initialNumToRender={20}
            renderItem={({ item }) => {
              const selected = item.id === value;
              const isDevice = item.id === deviceTz;
              return (
                <TouchableOpacity
                  style={[styles.row, selected && styles.rowSelected]}
                  onPress={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  {...a11yState({ selected })}
                  accessibilityLabel={`${item.label}${isDevice ? ', your device zone' : ''}`}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.rowId} numberOfLines={1}>
                      {item.id}
                      {isDevice ? ' · your device' : ''}
                    </Text>
                  </View>
                  {selected ? <Check size={18} color={Colors.primary} /> : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>No zone matches. Try a city name or “GMT+2”.</Text>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay.dark,
  },
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.displayFontFamilies.bold,
    color: Colors.text.primary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.background.primary,
    borderWidth: 1,
    borderColor: Colors.border.light,
  },
  searchInput: {
    flex: 1,
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamily,
    color: Colors.text.primary,
    paddingVertical: 10,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
    minHeight: 56,
    gap: Spacing.sm,
  },
  rowSelected: {
    backgroundColor: Colors.primarySoft,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: Typography.sizes.md,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  rowLabelSelected: {
    color: Colors.primary,
  },
  rowId: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  empty: {
    padding: Spacing.lg,
    textAlign: 'center',
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamily,
    color: Colors.text.tertiary,
  },
});

/**
 * Pinned under the event page's top bar while a host previews their own
 * event as an attendee (docs/EVENT_REHEARSAL_PLAN.md Phase 2, §3.2). Says
 * the mode out loud — visually and to screen readers on entry — and offers
 * the way out. Phase 3: a collapsible "Scenario" panel moves the guest to
 * another moment (days before / day of / happening now / ended) and sets
 * how full the event is; the collapsed banner names any active scenario so
 * a simulated state is never mistaken for the real one.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronUp, Eye } from '@/components/icons.generated';
import { announce, a11yState, choiceA11y } from '@/utils/accessibility';
import {
  REHEARSAL_SPOTS_LABEL,
  REHEARSAL_WHEN_LABEL,
  type RehearsalScenario,
  type RehearsalSpots,
  type RehearsalWhen,
} from '@/utils/rehearsal';
import {
  BorderRadius,
  Colors,
  FontScaleCaps,
  Shadows,
  Spacing,
  Typography,
} from '@/constants/theme';

export const REHEARSAL_BANNER_TITLE = 'Preview as attendee';
export const REHEARSAL_BANNER_NOTE = 'Nothing you do here is saved.';
export const REHEARSAL_BANNER_DRAFT =
  'Not published yet — this is how guests will see it once it is.';

const SPOTS: RehearsalSpots[] = ['real', 'open', 'full'];

/** "Simulating: Ended · Full", or null when everything is real. */
export function scenarioSummary(s: RehearsalScenario): string | null {
  const parts = [
    s.when !== 'real' ? REHEARSAL_WHEN_LABEL[s.when] : null,
    s.spots !== 'real' ? REHEARSAL_SPOTS_LABEL[s.spots] : null,
  ].filter(Boolean);
  return parts.length ? `Simulating: ${parts.join(' · ')}` : null;
}

export function RehearsalBanner({
  top,
  draft,
  scenario,
  whenOptions,
  onScenario,
  onExit,
}: {
  top: number;
  draft: boolean;
  scenario: RehearsalScenario;
  whenOptions: RehearsalWhen[];
  onScenario: (next: RehearsalScenario) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    announce(`${REHEARSAL_BANNER_TITLE}. ${REHEARSAL_BANNER_NOTE}`);
  }, []);
  const summary = scenarioSummary(scenario);
  const note = draft
    ? `${REHEARSAL_BANNER_NOTE} ${REHEARSAL_BANNER_DRAFT}`
    : REHEARSAL_BANNER_NOTE;

  const choose = (next: RehearsalScenario, label: string) => {
    onScenario(next);
    announce(`Showing: ${label}`);
  };

  return (
    <View style={[styles.wrap, { top }]} accessibilityRole="summary">
      <View style={styles.row}>
        <Eye size={18} color={Colors.text.inverse} />
        <View style={styles.texts}>
          <Text
            style={styles.title}
            accessibilityRole="header"
            maxFontSizeMultiplier={FontScaleCaps.control}
          >
            {REHEARSAL_BANNER_TITLE}
          </Text>
          <Text
            style={styles.note}
            maxFontSizeMultiplier={FontScaleCaps.control}
          >
            {summary ?? note}
          </Text>
        </View>
        {/* Wraps as a unit to its own line when the title would otherwise be
            squeezed into one word per line (a real 320 px phone). */}
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => setOpen((o) => !o)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Hide scenarios' : 'Try a scenario'}
            {...a11yState({ expanded: open })}
          >
            <Text
              style={styles.toggleText}
              maxFontSizeMultiplier={FontScaleCaps.control}
            >
              Scenario
            </Text>
            {open ? (
              <ChevronUp size={16} color={Colors.text.inverse} />
            ) : (
              <ChevronDown size={16} color={Colors.text.inverse} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onExit}
            style={styles.exit}
            accessibilityRole="button"
            accessibilityLabel="Exit preview"
          >
            <Text
              style={styles.exitText}
              maxFontSizeMultiplier={FontScaleCaps.control}
            >
              Exit
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {open ? (
        <View style={styles.panel}>
          {summary ? (
            <Text
              style={styles.note}
              maxFontSizeMultiplier={FontScaleCaps.control}
            >
              {note}
            </Text>
          ) : null}
          <Text
            style={styles.group}
            accessibilityRole="header"
            maxFontSizeMultiplier={FontScaleCaps.control}
          >
            When
          </Text>
          <View
            style={styles.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel="When"
          >
            {whenOptions.map((w) => {
              const selected = scenario.when === w;
              return (
                <TouchableOpacity
                  key={w}
                  onPress={() =>
                    choose({ ...scenario, when: w }, REHEARSAL_WHEN_LABEL[w])
                  }
                  style={[styles.chip, selected && styles.chipOn]}
                  {...choiceA11y(selected, REHEARSAL_WHEN_LABEL[w])}
                >
                  <Text
                    style={[styles.chipText, selected && styles.chipTextOn]}
                    maxFontSizeMultiplier={FontScaleCaps.control}
                  >
                    {REHEARSAL_WHEN_LABEL[w]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text
            style={styles.group}
            accessibilityRole="header"
            maxFontSizeMultiplier={FontScaleCaps.control}
          >
            Spots
          </Text>
          <View
            style={styles.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel="Spots"
          >
            {SPOTS.map((sp) => {
              const selected = scenario.spots === sp;
              return (
                <TouchableOpacity
                  key={sp}
                  onPress={() =>
                    choose(
                      { ...scenario, spots: sp },
                      REHEARSAL_SPOTS_LABEL[sp],
                    )
                  }
                  style={[styles.chip, selected && styles.chipOn]}
                  {...choiceA11y(
                    selected,
                    `Spots: ${REHEARSAL_SPOTS_LABEL[sp]}`,
                  )}
                >
                  <Text
                    style={[styles.chipText, selected && styles.chipTextOn]}
                    maxFontSizeMultiplier={FontScaleCaps.control}
                  >
                    {REHEARSAL_SPOTS_LABEL[sp]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 49,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.sm,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.text.primary,
    ...Shadows.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  texts: { flexGrow: 1, flexShrink: 1, flexBasis: 120 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginLeft: 'auto',
  },
  title: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.inverse,
  },
  note: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.regular,
    color: Colors.text.inverse,
  },
  toggle: {
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  toggleText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.inverse,
  },
  exit: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    backgroundColor: Colors.surface,
  },
  exitText: {
    fontSize: Typography.sizes.sm,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.primary,
  },
  panel: { marginTop: Spacing.sm, gap: Spacing.xs, paddingRight: Spacing.sm },
  group: {
    marginTop: Spacing.xs,
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.semibold,
    color: Colors.text.inverse,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.text.inverse,
  },
  chipOn: { backgroundColor: Colors.surface, borderColor: Colors.surface },
  chipText: {
    fontSize: Typography.sizes.xs,
    fontFamily: Typography.fontFamilies.medium,
    color: Colors.text.inverse,
  },
  chipTextOn: { color: Colors.text.primary },
});

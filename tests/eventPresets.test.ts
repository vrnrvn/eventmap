import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_SETTINGS,
  DEFAULT_PRESET_FORM,
  EVENT_PRESETS,
  applyPreset,
  defaultPresetForHostType,
  describePresetSettings,
  eventPreset,
  presetSettingsToApply,
  type PresetApplication,
} from '@/utils/eventPresets';

describe('event presets', () => {
  it('exposes four presets with stable ids', () => {
    expect(EVENT_PRESETS.map((p) => p.id)).toEqual(['casual', 'class', 'venue_show', 'large']);
    expect(eventPreset('large').form.maxAttendees).toBe('500');
    // Unknown id falls back rather than throwing (e.g. a stored event_type).
    expect(eventPreset('nope' as never).id).toBe('casual');
  });

  it('suggests venue show for venues, casual otherwise', () => {
    expect(defaultPresetForHostType('venue')).toBe('venue_show');
    expect(defaultPresetForHostType('organiser')).toBe('casual');
    expect(defaultPresetForHostType('individual')).toBe('casual');
    expect(defaultPresetForHostType(null)).toBe('casual');
  });

  it('fills a blank form', () => {
    const r = applyPreset(DEFAULT_PRESET_FORM, 'class');
    expect(r.values.maxAttendees).toBe('20');
    expect(r.kept).toEqual([]);
    expect(r.application).toEqual({ presetId: 'class', wrote: { maxAttendees: '20' } });
  });

  it('never overwrites a capacity the host typed', () => {
    const typed = { maxAttendees: '42' };
    const r = applyPreset(typed, 'large');
    expect(r.values.maxAttendees).toBe('42');
    expect(r.kept).toEqual(['maxAttendees']);
    // The kept value is recorded as the preset's, so switching again keeps it.
    const again = applyPreset(r.values, 'class', r.application);
    expect(again.values.maxAttendees).toBe('42');
  });

  it('replaces its own previous value when the host switches preset', () => {
    const first = applyPreset(DEFAULT_PRESET_FORM, 'class');
    const second = applyPreset(first.values, 'large', first.application);
    expect(second.values.maxAttendees).toBe('500');
    expect(second.kept).toEqual([]);
    const third = applyPreset(second.values, 'casual', second.application);
    expect(third.values.maxAttendees).toBe('');
  });

  it('treats an edit made after a preset as the host\'s own', () => {
    const applied = applyPreset(DEFAULT_PRESET_FORM, 'class');
    const edited = { maxAttendees: '25' };
    const next = applyPreset(edited, 'large', applied.application);
    expect(next.values.maxAttendees).toBe('25');
    expect(next.kept).toEqual(['maxAttendees']);
  });

  it('clearing capacity back to blank makes it overwritable again', () => {
    const applied = applyPreset(DEFAULT_PRESET_FORM, 'class');
    const cleared = { maxAttendees: '' };
    const next = applyPreset(cleared, 'large', applied.application);
    expect(next.values.maxAttendees).toBe('500');
  });

  it('only sends settings that differ from the server defaults', () => {
    // class matches every server default: notify / open / open.
    expect(presetSettingsToApply('class')).toBeNull();
    expect(presetSettingsToApply('casual')).toEqual({ waitlistMode: 'off' });
    expect(presetSettingsToApply('venue_show')).toEqual({ chatMode: 'announcements' });
    expect(presetSettingsToApply('large')).toEqual({ waitlistMode: 'auto', chatMode: 'announcements' });
  });

  it('every preset setting is a valid server value', () => {
    for (const p of EVENT_PRESETS) {
      expect(['off', 'notify', 'auto']).toContain(p.settings.waitlistMode);
      expect(['open', 'approval']).toContain(p.settings.rsvpMode);
      expect(['open', 'announcements', 'off']).toContain(p.settings.chatMode);
      // Presets never silently turn on approval: that stays a host decision.
      expect(p.settings.rsvpMode).toBe(DEFAULT_EVENT_SETTINGS.rsvpMode);
    }
  });

  it('describes what a preset sets up', () => {
    expect(describePresetSettings('casual')).toBe('No cap · no waitlist · chat on');
    expect(describePresetSettings('large')).toBe('Cap 500 · waitlist with auto-promote · announcements-only chat');
  });

  it('a previous application from an unknown preset is harmless', () => {
    const stale = { presetId: 'gone', wrote: { maxAttendees: '7' } } as unknown as PresetApplication;
    const r = applyPreset({ maxAttendees: '7' }, 'class', stale);
    expect(r.values.maxAttendees).toBe('20');
  });
});

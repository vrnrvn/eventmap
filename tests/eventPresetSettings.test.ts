import { beforeEach, describe, expect, it, vi } from 'vitest';
// vi.mock calls below are hoisted above every import by vitest.
import { applyPresetSettings } from '@/services/eventPresetSettings';

// vi.mock factories are hoisted above the file body, so the spies have to be
// created with vi.hoisted to exist by the time the factories run.
const { setEventSettings, setMode, updateEvent } = vi.hoisted(() => ({
  setEventSettings: vi.fn(),
  setMode: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock('@/services/hostTools', () => ({ hostToolsService: { setEventSettings } }));
vi.mock('@/services/eventChat', () => ({ eventChatService: { setMode } }));
vi.mock('@/services/events', () => ({ eventsService: { updateEvent } }));

beforeEach(() => {
  setEventSettings.mockReset().mockResolvedValue(undefined);
  setMode.mockReset().mockResolvedValue(undefined);
  updateEvent.mockReset().mockResolvedValue(undefined);
});

describe('applyPresetSettings', () => {
  it('records the preset on the event for analytics', async () => {
    await applyPresetSettings('e1', 'class');
    expect(updateEvent).toHaveBeenCalledWith('e1', { event_type: 'class' });
  });

  it('skips the RPCs when the preset matches the server defaults', async () => {
    const r = await applyPresetSettings('e1', 'class');
    expect(r).toEqual({ skipped: true, failed: [] });
    expect(setEventSettings).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
  });

  it('sends only the waitlist change for a casual meetup', async () => {
    const r = await applyPresetSettings('e1', 'casual');
    expect(setEventSettings).toHaveBeenCalledWith('e1', { waitlistMode: 'off', rsvpMode: undefined });
    expect(setMode).not.toHaveBeenCalled();
    expect(r).toEqual({ skipped: false, failed: [] });
  });

  it('sends waitlist and chat for a large event', async () => {
    await applyPresetSettings('e1', 'large');
    expect(setEventSettings).toHaveBeenCalledWith('e1', { waitlistMode: 'auto', rsvpMode: undefined });
    expect(setMode).toHaveBeenCalledWith('e1', { mode: 'announcements' });
  });

  it('reports failures instead of throwing, so publishing is never blocked', async () => {
    setEventSettings.mockRejectedValue(new Error('rpc missing'));
    setMode.mockRejectedValue(new Error('rpc missing'));
    const r = await applyPresetSettings('e1', 'large');
    expect(r.failed).toEqual(['the waitlist option', 'the chat option']);
  });

  it('a failed chat call still leaves the waitlist applied', async () => {
    setMode.mockRejectedValue(new Error('nope'));
    const r = await applyPresetSettings('e1', 'venue_show');
    expect(r.failed).toEqual(['the chat option']);
    expect(setEventSettings).not.toHaveBeenCalled(); // venue_show only differs on chat
  });

  it('a missing event_type column never affects the result', async () => {
    updateEvent.mockRejectedValue({ code: 'PGRST204' });
    const r = await applyPresetSettings('e1', 'casual');
    expect(r).toEqual({ skipped: false, failed: [] });
  });
});

describe('carryOverToDuplicate', () => {
  it('copies the preset id and a non-default chat mode', async () => {
    const { carryOverToDuplicate } = await import('@/services/eventPresetSettings');
    expect(await carryOverToDuplicate('copy', { eventType: 'large', chatMode: 'announcements' })).toBe(true);
    expect(updateEvent).toHaveBeenCalledWith('copy', { event_type: 'large' });
    expect(setMode).toHaveBeenCalledWith('copy', { mode: 'announcements' });
  });
  it('does nothing for a default-chat event without a preset', async () => {
    const { carryOverToDuplicate } = await import('@/services/eventPresetSettings');
    expect(await carryOverToDuplicate('copy', { eventType: null, chatMode: 'open' })).toBe(true);
    expect(updateEvent).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
  });
  it('reports a failed chat copy so the host can be told', async () => {
    const { carryOverToDuplicate } = await import('@/services/eventPresetSettings');
    setMode.mockRejectedValue(new Error('rpc missing'));
    expect(await carryOverToDuplicate('copy', { chatMode: 'off' })).toBe(false);
  });
});

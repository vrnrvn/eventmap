/**
 * Universal links / web paths for sharing events (see app/event/[id].tsx).
 */
export function getEventWebUrl(eventId: string): string {
  const base = (process.env.EXPO_PUBLIC_APP_WEB_ORIGIN ?? 'https://eventmap.pro').replace(/\/$/, '');
  return `${base}/event/${eventId}`;
}

function padUtcGcal(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/** Opens Google Calendar “create event” with prefilled fields. */
export function getGoogleCalendarEventUrl(opts: {
  title: string;
  startIso: string;
  endIso: string;
  address?: string | null;
  details?: string;
}): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${padUtcGcal(opts.startIso)}/${padUtcGcal(opts.endIso)}`,
  });
  if (opts.address) params.set('location', opts.address);
  if (opts.details) params.set('details', opts.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

import { getConnectivity } from './connectivity';
import { notify } from './notify';

/**
 * For actions that need the server's answer and are never queued (RSVP,
 * waitlist, reviews, reports, blocking, publishing and editing events,
 * uploads): when the device is offline, say so and return true so the
 * caller stops, instead of sending a request that can only fail
 * (docs/OFFLINE_PLAN.md §3.7). `action` completes "Connect to …".
 */
export function blockedOffline(action: string): boolean {
  if (getConnectivity() !== 'offline') return false;
  notify.error(`You're offline. Connect to ${action}.`);
  return true;
}

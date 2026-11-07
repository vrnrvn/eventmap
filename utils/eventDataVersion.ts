/**
 * A process-wide counter bumped by every successful write that can change
 * what an event page shows (RSVPs, saves, follows, event edits, host
 * actions). Screens that refetch on focus compare it against the version
 * they last loaded at, so a refetch can be skipped when data is seconds old
 * and provably nothing was written since — whichever screen did the write.
 * Pure module (no React Native imports) so services stay node-testable.
 */
let version = 0;

export function getEventDataVersion(): number {
  return version;
}

export function bumpEventDataVersion(): void {
  version += 1;
}

/**
 * Wraps the named async methods of a service object in place so each
 * successful call bumps the version. `this` is preserved (services call
 * sibling methods through it).
 */
export function signalEventWrites<T extends object>(service: T, methods: readonly (keyof T)[]): T {
  for (const name of methods) {
    const original = service[name];
    if (typeof original !== 'function') {
      throw new Error(`signalEventWrites: ${String(name)} is not a method`);
    }
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const result = await (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
      bumpEventDataVersion();
      return result;
    };
    (service as Record<keyof T, unknown>)[name] = wrapped;
  }
  return service;
}

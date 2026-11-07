import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { authService } from '@/services/auth';
import { Profile } from '@/types/database';
import { profilesService } from '@/services/profiles';
import { bannedService } from '@/services/banned';
import { deactivatePushToken, registerPushToken } from '@/services/pushNotifications';
import {
  clearOfflineSnapshots,
  readProfileSnapshot,
  writeProfileSnapshot,
} from '@/services/offlineSnapshots';
import { isRetryableError } from '@/utils/networkErrors';
import { flushPendingWrites } from '@/services/pendingWrites';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { createRetryGate } from '@/utils/retryBackoff';

/**
 * How long startup waits for supabase-js to restore (and, if expired,
 * refresh) the session before falling back to the stored one. Offline, the
 * refresh retries with backoff for ~25 s; nobody should stare at a spinner
 * that long when the device already knows who they are.
 */
const STARTUP_SESSION_WAIT_MS = 6000;

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /**
   * True only while the stored session is being restored — unlike `loading`,
   * this does not wait for the profile fetch, so providers that only need
   * the user id (AppContext's business load) can start in parallel with it.
   */
  sessionLoading: boolean;
  /** True when the signed-in user's profile failed to load (network/server error). */
  profileError: boolean;
  /**
   * The session came from device storage because the server couldn't be
   * reached to verify or refresh it. The user stays signed in; it clears on
   * the next successful refresh, or a real sign-out follows if the server
   * rejects it.
   */
  sessionStale: boolean;
  /** The profile shown is the device snapshot or an earlier load; a refresh is pending. */
  profileStale: boolean;
  hasCompletedOnboarding: boolean;
  isBanned: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    name: string
  ) => Promise<{ user: User; session: Session | null } | null>;
  signInWithOAuth: (provider: 'google' | 'facebook') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(true);
  // Which user's profile load has finished (success OR error). Derived at
  // render time so there is never a frame where a signed-in user looks
  // "loaded" before the profile fetch was even attempted.
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [sessionStale, setSessionStale] = useState(false);
  const [profileStale, setProfileStale] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  // Latest values for async callbacks (snapshot writes, reconnect retries).
  const isBannedRef = useRef(false);
  isBannedRef.current = isBanned;
  const sessionStaleRef = useRef(false);
  sessionStaleRef.current = sessionStale;
  // A load skipped its fetch because the session was unverified; it runs
  // once the session is verified.
  const skippedForStaleRef = useRef(false);
  const [activePushToken, setActivePushToken] = useState<string | null>(null);

  // Monotonic sequence guarding loadProfile: a slow fetch from a previous
  // sign-in (or a retry superseded by a newer one) must not apply after
  // sign-out or after another user signed in — a stale resolution would leak
  // the old user's profile into state and set profileLoadedFor to the old
  // uid, stranding `loading` as true with nothing left to re-trigger it.
  const loadSeqRef = useRef(0);
  // User id whose onboarded profile is loaded. A failed refresh for that
  // same user (Settings save, avatar change, flaky network) keeps it instead
  // of raising profileError, which would bounce them out of the tabs.
  const onboardedProfileForRef = useRef<string | null>(null);

  /**
   * Loads the profile and ban status for `userId`.
   *
   * `useSnapshot` (first load for a user): an onboarded snapshot saved on
   * this device is shown at once, so the app opens straight into the tabs
   * offline or before the network answers, then refreshed in the
   * background.
   *
   * While the session is unverified (sessionStale) nothing is fetched:
   * supabase-js sends requests with the anonymous key when it can't refresh
   * the token, and an anonymous profile read can come back empty — which
   * would look like "not onboarded" and route into onboarding. The load runs
   * once the session is verified.
   */
  const loadProfile = async (userId: string, { useSnapshot = false } = {}) => {
    // Distinguish "failed to load" from "loaded, no row": a transient error
    // must never route an onboarded user back into onboarding (which would
    // overwrite their preferences on completion).
    const seq = ++loadSeqRef.current;
    if (useSnapshot) {
      const snapshot = await readProfileSnapshot(userId);
      if (seq !== loadSeqRef.current) return;
      if (snapshot) {
        setProfile(snapshot.data.profile);
        setIsBanned(snapshot.data.isBanned);
        setProfileError(false);
        setProfileStale(true);
        onboardedProfileForRef.current = userId;
        setProfileLoadedFor(userId);
      }
    }
    if (sessionStaleRef.current) {
      skippedForStaleRef.current = true;
      if (onboardedProfileForRef.current !== userId) setProfileError(true);
      else setProfileStale(true);
      setProfileLoadedFor(userId);
      return;
    }
    try {
      const [userProfile, banned] = await Promise.all([
        profilesService.getProfile(userId),
        // A failed ban check keeps the last known value instead of failing
        // the whole load. Bans are enforced server-side (RLS); this flag
        // only gates the UI.
        bannedService.isUserBanned(userId).catch(() => null),
      ]);
      if (seq !== loadSeqRef.current) return;
      const nextBanned = banned ?? isBannedRef.current;
      setProfile(userProfile);
      setIsBanned(nextBanned);
      setProfileError(false);
      setProfileStale(false);
      onboardedProfileForRef.current =
        userProfile?.has_completed_onboarding === true ? userId : null;
      if (userProfile) writeProfileSnapshot(userId, { profile: userProfile, isBanned: nextBanned });
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading profile:', error);
      // Only keep a profile that has finished onboarding: keeping an
      // un-onboarded one would route back into onboarding, so that case
      // still gets the retry screen.
      if (onboardedProfileForRef.current === userId) {
        setProfileStale(true);
        return;
      }
      setProfileError(true);
    } finally {
      if (seq === loadSeqRef.current) setProfileLoadedFor(userId);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const applySession = (next: Session | null) => {
      setSession(next);
      // TOKEN_REFRESHED delivers a fresh user object for the same account
      // (~hourly). Keeping the previous object when nothing user-visible
      // changed stops every effect keyed on `user` from re-running on each
      // refresh (the EventDetail reviews reload was one such casualty).
      setUser((prev) => {
        const nextUser = next?.user ?? null;
        if (!prev || !nextUser) return nextUser;
        return prev.id === nextUser.id && prev.updated_at === nextUser.updated_at ? prev : nextUser;
      });
      setSessionStale(false);
    };
    // Stay signed in on the stored session; the server hasn't vouched for it.
    const applyStoredSession = async () => {
      const stored = await authService.readStoredSession();
      if (cancelled || !stored) return false;
      setSession(stored);
      setUser(stored.user);
      setSessionStale(true);
      return true;
    };

    // The refresh is slow or unreachable: continue on the stored session now.
    // getSession keeps going and replaces it below when it settles.
    let fellBack = false;
    const fallBackToStored = () => {
      if (settled || fellBack) return;
      fellBack = true;
      void applyStoredSession().finally(() => {
        if (!cancelled && !settled) setInitializing(false);
      });
    };
    const startupTimer = setTimeout(fallBackToStored, STARTUP_SESSION_WAIT_MS);
    // Known offline: nothing to wait for, continue on the stored session now
    // (otherwise the first seconds of an offline start have no user, and
    // taps on deep-linked screens do nothing).
    if (getConnectivity() === 'offline') fallBackToStored();
    const unsubscribeStartupConnectivity = subscribeConnectivity((status) => {
      if (status === 'offline') fallBackToStored();
    });

    authService
      .getSession()
      .then(async (currentSession) => {
        settled = true;
        if (cancelled) return;
        applySession(currentSession);
        if (currentSession) return;
        // A session was stored but supabase-js no longer has one: its own
        // startup refresh was rejected and it removed the session (retryable
        // failures keep it). Treat it as a sign-out for the snapshots too.
        const priorUserId = await authService.storedUserIdAtLaunch();
        if (priorUserId) void clearOfflineSnapshots(priorUserId);
      })
      .catch(async (error) => {
        settled = true;
        if (cancelled) return;
        if (isRetryableError(error)) {
          // Couldn't reach the server (offline, timeout, 5xx). supabase-js
          // keeps the stored session in this case, so keep the user too.
          // If nothing is stored, state stays signed out.
          await applyStoredSession();
          return;
        }
        // The server rejected the session (e.g. revoked refresh token);
        // supabase-js has removed it. Remove this user's device snapshots
        // too: the userId effect never saw them signed in this launch.
        console.error('Unable to restore session:', error);
        applySession(null);
        const priorUserId = await authService.storedUserIdAtLaunch();
        if (priorUserId) void clearOfflineSnapshots(priorUserId);
      })
      .finally(() => {
        clearTimeout(startupTimer);
        unsubscribeStartupConnectivity();
        if (!cancelled) setInitializing(false);
      });

    // IMPORTANT: this callback must stay synchronous. Awaiting Supabase
    // queries inside onAuthStateChange deadlocks supabase-js (the client
    // serializes auth operations behind this callback). Profile loading
    // happens in the effect below, keyed on the user id — which also means
    // TOKEN_REFRESHED (same user id) doesn't re-trigger a profile reload
    // or loading flash.
    const { data: authListener } = authService.onAuthStateChange((newSession, event) => {
      if (!newSession) {
        // Only a real sign-out clears the user. INITIAL_SESSION also
        // arrives with null when the session couldn't be refreshed offline;
        // the startup code above decides that case.
        if (event === 'SIGNED_OUT') applySession(null);
        return;
      }
      applySession(newSession);
    });

    return () => {
      cancelled = true;
      clearTimeout(startupTimer);
      unsubscribeStartupConnectivity();
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // While unverified, nudge supabase-js to refresh as soon as the connection
  // is back or the app returns to the foreground (its own ticker would get
  // there within 30 s). Success fires TOKEN_REFRESHED, which clears the flag.
  useEffect(() => {
    if (!sessionStale) return;
    const tryRefresh = () => {
      if (getConnectivity() === 'offline') return;
      void authService.getSession().catch(() => {});
    };
    const unsubscribe = subscribeConnectivity((status) => {
      if (status !== 'offline') tryRefresh();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') tryRefresh();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [sessionStale]);

  // Load the profile whenever the signed-in user changes (initial restore,
  // sign-in, account switch). Single source of profile fetching — signIn /
  // signUp / OAuth no longer fetch manually, so there is no double fetch.
  const userId = user?.id ?? null;
  // The last signed-in user, so their device snapshots can be removed when
  // they sign out (here or because the server revoked the session).
  const lastUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      // Invalidate any in-flight load so it can't repopulate state post-sign-out.
      loadSeqRef.current++;
      onboardedProfileForRef.current = null;
      setProfile(null);
      setIsBanned(false);
      setProfileError(false);
      setProfileStale(false);
      setProfileLoadedFor(null);
      if (lastUserIdRef.current) {
        void clearOfflineSnapshots(lastUserIdRef.current);
        lastUserIdRef.current = null;
      }
      return;
    }
    lastUserIdRef.current = userId;
    let cancelled = false;
    // setTimeout(0) defers past any in-flight auth callback tick.
    const timer = setTimeout(() => {
      if (cancelled) return;
      loadProfile(userId, { useSnapshot: true });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

  // Refresh a snapshot / stale / failed profile without the user asking:
  // as soon as the session is verified, on reconnect and on foreground.
  const needsProfileRefresh = !!userId && !sessionStale && (profileStale || profileError);
  const profileRetryGate = useRef(createRetryGate());
  useEffect(() => {
    if (!needsProfileRefresh) profileRetryGate.current.reset();
  }, [needsProfileRefresh]);
  useEffect(() => {
    if (!needsProfileRefresh || !userId) return;
    if (skippedForStaleRef.current) {
      skippedForStaleRef.current = false;
      loadProfile(userId);
    }
    // Backed off (utils/retryBackoff): a weak link flapping degraded ↔
    // online, or repeated foregrounds, used to retry every time.
    const retry = (force = false) => {
      if (getConnectivity() === 'offline') return;
      if (profileRetryGate.current.tryAcquire({ force })) loadProfile(userId);
    };
    let previous = getConnectivity();
    const unsubscribe = subscribeConnectivity((status) => {
      const was = previous;
      previous = status;
      if (status === 'online' && was !== 'online') retry(was === 'offline');
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
    // loadProfile reads only refs and setters, so the captured copy stays
    // correct; the flags above decide when this runs.
  }, [needsProfileRefresh, userId]);

  useEffect(() => {
    let cancelled = false;

    const syncPush = async () => {
      if (!user) return;
      try {
        const token = await registerPushToken();
        if (!cancelled) {
          setActivePushToken(token);
        }
      } catch (err) {
        console.error('Push registration failed:', err);
      }
    };

    syncPush();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Profile loading for all sign-in variants is handled by the userId effect
  // above (no manual loadProfile here — avoids a double fetch with the
  // auth-state listener).
  const signIn = useCallback(async (email: string, password: string) => {
    const data = await authService.signIn(email, password);
    setSession(data.session);
    setUser(data.user);
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const data = await authService.signUp(email, password, name);
    // With email confirmation on, signUp returns a user but no session. Putting
    // that user in state would kick off a profile fetch and a push-token
    // registration for an identity RLS rejects — every route guard keys off
    // `session`, so the unauthenticated user object has no use here.
    if (data.session) {
      setSession(data.session);
      setUser(data.user);
    }
    if (data.user) {
      return { user: data.user, session: data.session };
    }
    return null;
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'facebook') => {
    const data = await authService.signInWithOAuth(provider);
    if (!data?.user) return;
    const name =
      data.user.user_metadata?.full_name ??
      data.user.user_metadata?.name ??
      data.user.email?.split('@')[0] ??
      '';
    try {
      await profilesService.ensureProfileExists(data.user.id, name);
    } catch (err) {
      // Onboarding also ensures the row exists; don't block sign-in on this.
      console.error('ensureProfileExists failed:', err);
    }
    setSession(data.session);
    setUser(data.user);
  }, []);

  // Best-effort sign-out: server revoke and push-token cleanup may fail
  // offline, but local state is always cleared so the user is never stranded.
  const signOut = useCallback(async () => {
    // Send anything queued offline first: sign-out removes the queue with
    // the rest of this user's device data. Returns at once when offline.
    await flushPendingWrites().catch(() => {});
    if (activePushToken) {
      try {
        await deactivatePushToken(activePushToken);
      } catch (err) {
        console.error('Failed to deactivate push token:', err);
      }
    }
    try {
      await authService.signOut(); // never throws (handles revoke failure itself)
    } catch (err) {
      console.error('Sign-out failed:', err);
    }
    setSession(null);
    setUser(null);
    setSessionStale(false);
    setProfile(null);
    setProfileError(false);
    setIsBanned(false);
    setActivePushToken(null);
  }, [activePushToken]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    if (sessionStaleRef.current) {
      // Verify the session first; on success TOKEN_REFRESHED clears the
      // flag and the effect above loads the profile.
      if (getConnectivity() !== 'offline') await authService.getSession().catch(() => {});
      return;
    }
    await loadProfile(user.id);
  }, [user]);

  const hasCompletedOnboarding = profile?.has_completed_onboarding === true;
  const loading = initializing || (!!user && profileLoadedFor !== user.id);

  // Memoized: every screen consumes this context, so a fresh object each
  // render would re-render the whole app on any provider state change.
  const value = useMemo(
    () => ({
      session,
      user,
      profile,
      loading,
      sessionLoading: initializing,
      profileError,
      sessionStale,
      profileStale,
      hasCompletedOnboarding,
      isBanned,
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      refreshProfile,
    }),
    [
      session,
      user,
      profile,
      loading,
      initializing,
      profileError,
      sessionStale,
      profileStale,
      hasCompletedOnboarding,
      isBanned,
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

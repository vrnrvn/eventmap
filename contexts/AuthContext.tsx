import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { authService } from '@/services/auth';
import { Profile } from '@/types/database';
import { profilesService } from '@/services/profiles';
import { bannedService } from '@/services/banned';
import { deactivatePushToken, registerPushToken } from '@/services/pushNotifications';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** True when the signed-in user's profile failed to load (network/server error). */
  profileError: boolean;
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
  const [isBanned, setIsBanned] = useState(false);
  const [activePushToken, setActivePushToken] = useState<string | null>(null);

  // Monotonic sequence guarding loadProfile: a slow fetch from a previous
  // sign-in (or a retry superseded by a newer one) must not apply after
  // sign-out or after another user signed in — a stale resolution would leak
  // the old user's profile into state and set profileLoadedFor to the old
  // uid, stranding `loading` as true with nothing left to re-trigger it.
  const loadSeqRef = useRef(0);

  const loadProfile = async (userId: string) => {
    // Distinguish "failed to load" from "loaded, no row": a transient error
    // must never route an onboarded user back into onboarding (which would
    // overwrite their preferences on completion).
    const seq = ++loadSeqRef.current;
    try {
      const [userProfile, banned] = await Promise.all([
        profilesService.getProfile(userId),
        bannedService.isUserBanned(userId),
      ]);
      if (seq !== loadSeqRef.current) return;
      setProfile(userProfile);
      setIsBanned(banned);
      setProfileError(false);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading profile:', error);
      setProfileError(true);
    } finally {
      if (seq === loadSeqRef.current) setProfileLoadedFor(userId);
    }
  };

  useEffect(() => {
    authService
      .getSession()
      .then((currentSession) => {
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
      })
      .catch((error) => {
        console.error('Unable to restore session:', error);
      })
      .finally(() => setInitializing(false));

    // IMPORTANT: this callback must stay synchronous. Awaiting Supabase
    // queries inside onAuthStateChange deadlocks supabase-js (the client
    // serializes auth operations behind this callback). Profile loading
    // happens in the effect below, keyed on the user id — which also means
    // TOKEN_REFRESHED (same user id) doesn't re-trigger a profile reload
    // or loading flash.
    const { data: authListener } = authService.onAuthStateChange(
      (newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Load the profile whenever the signed-in user changes (initial restore,
  // sign-in, account switch). Single source of profile fetching — signIn /
  // signUp / OAuth no longer fetch manually, so there is no double fetch.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      // Invalidate any in-flight load so it can't repopulate state post-sign-out.
      loadSeqRef.current++;
      setProfile(null);
      setIsBanned(false);
      setProfileError(false);
      setProfileLoadedFor(null);
      return;
    }
    let cancelled = false;
    // setTimeout(0) defers past any in-flight auth callback tick.
    const timer = setTimeout(() => {
      if (cancelled) return;
      loadProfile(userId);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId]);

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
  const signIn = async (email: string, password: string) => {
    const data = await authService.signIn(email, password);
    setSession(data.session);
    setUser(data.user);
  };

  const signUp = async (email: string, password: string, name: string) => {
    const data = await authService.signUp(email, password, name);
    setSession(data.session);
    setUser(data.user);
    if (data.user) {
      return { user: data.user, session: data.session };
    }
    return null;
  };

  const signInWithOAuth = async (provider: 'google' | 'facebook') => {
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
  };

  // Best-effort sign-out: server revoke and push-token cleanup may fail
  // offline, but local state is always cleared so the user is never stranded.
  const signOut = async () => {
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
    setProfile(null);
    setProfileError(false);
    setIsBanned(false);
    setActivePushToken(null);
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  const hasCompletedOnboarding = profile?.has_completed_onboarding === true;
  const loading = initializing || (!!user && profileLoadedFor !== user.id);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        profileError,
        hasCompletedOnboarding,
        isBanned,
        signIn,
        signUp,
        signInWithOAuth,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

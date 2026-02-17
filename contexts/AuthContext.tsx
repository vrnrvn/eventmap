import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { authService } from '@/services/auth';
import { Profile } from '@/types/database';
import { profilesService } from '@/services/profiles';
import { bannedService } from '@/services/banned';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  hasCompletedOnboarding: boolean;
  isBanned: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<{ user: User } | null>;
  signInWithOAuth: (provider: 'google' | 'facebook') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBanned, setIsBanned] = useState(false);

  const loadProfile = async (userId: string) => {
    try {
      const [userProfile, banned] = await Promise.all([
        profilesService.getProfile(userId),
        bannedService.isUserBanned(userId),
      ]);
      setProfile(userProfile);
      setIsBanned(banned);
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  useEffect(() => {
    authService.getSession().then((currentSession) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) {
        loadProfile(currentSession.user.id);
      }
      setLoading(false);
    });

    const { data: authListener } = authService.onAuthStateChange(
      (newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          loadProfile(newSession.user.id);
        } else {
          setProfile(null);
          setIsBanned(false);
        }
        setLoading(false);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const data = await authService.signIn(email, password);
    setSession(data.session);
    setUser(data.user);
    if (data.user) {
      await loadProfile(data.user.id);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    const data = await authService.signUp(email, password, name);
    setSession(data.session);
    setUser(data.user);
    if (data.user) {
      await loadProfile(data.user.id);
      return { user: data.user };
    }
    return null;
  };

  const signInWithOAuth = async (provider: 'google' | 'facebook') => {
    const data = await authService.signInWithOAuth(provider);
    setSession(data.session);
    setUser(data.user);
    if (data.user) {
      const name =
        data.user.user_metadata?.full_name ??
        data.user.user_metadata?.name ??
        data.user.email?.split('@')[0] ??
        '';
      await profilesService.ensureProfileExists(data.user.id, name);
      await loadProfile(data.user.id);
    }
  };

  const signOut = async () => {
    await authService.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setIsBanned(false);
  };

  const refreshProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  const hasCompletedOnboarding = profile?.has_completed_onboarding === true;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
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

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Business } from '@/types/database';
import { businessesService } from '@/services/businesses';
import { useAuth } from './AuthContext';
import { readBusinessSnapshot, writeBusinessSnapshot } from '@/services/offlineSnapshots';
import { getConnectivity, subscribeConnectivity } from '@/utils/connectivity';
import { UserMode } from '@/types/app';

type AppContextType = {
  userMode: UserMode;
  setUserMode: (mode: UserMode) => void;
  userBusiness: Business | null;
  loading: boolean;
  refreshBusiness: () => Promise<void>;
  hasBusiness: boolean;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

// Keyed per user so one account's business mode never leaks into another
// account on the same device.
const userModeStorageKey = (userId: string) => `eventmap.userMode.${userId}`;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, sessionStale } = useAuth();
  const [userMode, setUserModeState] = useState<UserMode>('user');
  const [userBusiness, setUserBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const setUserMode = useCallback(
    (mode: UserMode) => {
      setUserModeState(mode);
      if (user) {
        AsyncStorage.setItem(userModeStorageKey(user.id), mode).catch(() => {
          // Persistence is best-effort; the session keeps the in-memory mode.
        });
      }
    },
    [user]
  );

  // Guards against a slow load for a previous user applying after a switch.
  const loadSeqRef = useRef(0);
  // The last network load failed (or was skipped); retried on reconnect.
  const [businessStale, setBusinessStale] = useState(false);
  // A load skipped its fetch because the session was unverified.
  const skippedForStaleRef = useRef(false);

  const applyBusiness = (business: Business | null, storedMode: string | null) => {
    setUserBusiness(business);
    if (!business) {
      setUserModeState('user');
    } else if (storedMode === 'business' || storedMode === 'user') {
      setUserModeState(storedMode);
    }
  };

  /**
   * The device snapshot (if any) shows at once, so a business user keeps
   * business mode and the Create tab offline; the network result replaces
   * it. While the session is unverified the fetch is skipped: an anonymous
   * get_user_business returns no business, which would hide the Create tab
   * and overwrite the snapshot (docs/OFFLINE_PLAN.md §3.6).
   */
  const loadBusiness = async ({ useSnapshot = false } = {}) => {
    const seq = ++loadSeqRef.current;
    if (!user) {
      setUserBusiness(null);
      setUserModeState('user');
      setBusinessStale(false);
      setLoading(false);
      return;
    }
    const uid = user.id;
    const storedMode = await AsyncStorage.getItem(userModeStorageKey(uid)).catch(() => null);
    if (seq !== loadSeqRef.current) return;
    if (useSnapshot) {
      const snapshot = await readBusinessSnapshot(uid);
      if (seq !== loadSeqRef.current) return;
      if (snapshot) {
        applyBusiness(snapshot.data.business, storedMode);
        setLoading(false);
      }
    }
    if (sessionStale) {
      skippedForStaleRef.current = true;
      setBusinessStale(true);
      setLoading(false);
      return;
    }

    try {
      const business = await businessesService.getUserBusiness();
      if (seq !== loadSeqRef.current) return;
      applyBusiness(business, storedMode);
      writeBusinessSnapshot(uid, { business });
      setBusinessStale(false);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      // Keep whatever is shown (snapshot or previous load).
      console.error('Error loading business:', error);
      setBusinessStale(true);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadBusiness({ useSnapshot: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // Retry a failed or skipped load once the session is verified, on
  // reconnect and on foreground.
  useEffect(() => {
    if (!businessStale || sessionStale || !user) return;
    if (skippedForStaleRef.current) {
      skippedForStaleRef.current = false;
      loadBusiness();
    }
    const retry = () => {
      if (getConnectivity() !== 'offline') loadBusiness();
    };
    let previous = getConnectivity();
    const unsubscribe = subscribeConnectivity((status) => {
      const wasOnline = previous === 'online';
      previous = status;
      if (status === 'online' && !wasOnline) retry();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessStale, sessionStale, user?.id]);

  const refreshBusiness = async () => {
    setLoading(true);
    await loadBusiness();
  };

  return (
    <AppContext.Provider
      value={{
        userMode,
        setUserMode,
        userBusiness,
        loading: loading || authLoading,
        refreshBusiness,
        hasBusiness: !!userBusiness,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

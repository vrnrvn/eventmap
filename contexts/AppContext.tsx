import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Business } from '@/types/database';
import { businessesService } from '@/services/businesses';
import { useAuth } from './AuthContext';
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
  const { user, loading: authLoading } = useAuth();
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

  const loadBusiness = async () => {
    if (!user) {
      setUserBusiness(null);
      setUserModeState('user');
      setLoading(false);
      return;
    }

    try {
      const [business, storedMode] = await Promise.all([
        businessesService.getUserBusiness(),
        AsyncStorage.getItem(userModeStorageKey(user.id)).catch(() => null),
      ]);
      setUserBusiness(business);
      if (!business) {
        setUserModeState('user');
      } else if (storedMode === 'business' || storedMode === 'user') {
        setUserModeState(storedMode);
      }
    } catch (error) {
      console.error('Error loading business:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadBusiness();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

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

import React, { createContext, useContext, useEffect, useState } from 'react';
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [userMode, setUserMode] = useState<UserMode>('user');
  const [userBusiness, setUserBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBusiness = async () => {
    if (!user) {
      setUserBusiness(null);
      setLoading(false);
      return;
    }

    try {
      const business = await businessesService.getUserBusiness();
      setUserBusiness(business);
      if (!business) {
        setUserMode('user');
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

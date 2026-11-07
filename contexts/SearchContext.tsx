import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';

export type SearchLocation = {
  lat: number;
  lng: number;
  label: string;
};

export type SearchDateRange = {
  start: Date;
  end: Date;
};

type SearchContextType = {
  location: SearchLocation | null;
  dateRange: SearchDateRange | null;
  setLocation: (loc: SearchLocation | null) => void;
  setDateRange: (range: SearchDateRange | null) => void;
  clearAll: () => void;
  hasSelection: boolean;
};

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<SearchLocation | null>(null);
  const [dateRange, setDateRangeState] = useState<SearchDateRange | null>(null);

  const setLocation = useCallback((loc: SearchLocation | null) => {
    setLocationState(loc);
  }, []);

  const setDateRange = useCallback((range: SearchDateRange | null) => {
    setDateRangeState(range);
  }, []);

  const clearAll = useCallback(() => {
    setLocationState(null);
    setDateRangeState(null);
  }, []);

  const hasSelection = location != null || dateRange != null;

  const value = useMemo(
    () => ({ location, dateRange, setLocation, setDateRange, clearAll, hasSelection }),
    [location, dateRange, setLocation, setDateRange, clearAll, hasSelection]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}

import React, { createContext, useContext, useState, useCallback } from 'react';

export type SearchLocation = {
  lat: number;
  lng: number;
  label: string;
};

export type SearchDateRange = {
  start: Date;
  end: Date;
};

export type SearchGuests = {
  adults: number;
  children: number;
  infants: number;
};

type SearchContextType = {
  location: SearchLocation | null;
  dateRange: SearchDateRange | null;
  guests: SearchGuests;
  setLocation: (loc: SearchLocation | null) => void;
  setDateRange: (range: SearchDateRange | null) => void;
  setGuests: (guests: SearchGuests) => void;
  clearAll: () => void;
  hasSelection: boolean;
};

const defaultGuests: SearchGuests = { adults: 1, children: 0, infants: 0 };

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<SearchLocation | null>(null);
  const [dateRange, setDateRangeState] = useState<SearchDateRange | null>(null);
  const [guests, setGuestsState] = useState<SearchGuests>(defaultGuests);

  const setLocation = useCallback((loc: SearchLocation | null) => {
    setLocationState(loc);
  }, []);

  const setDateRange = useCallback((range: SearchDateRange | null) => {
    setDateRangeState(range);
  }, []);

  const setGuests = useCallback((g: SearchGuests) => {
    setGuestsState(g);
  }, []);

  const clearAll = useCallback(() => {
    setLocationState(null);
    setDateRangeState(null);
    setGuestsState(defaultGuests);
  }, []);

  const hasSelection =
    location != null || dateRange != null || guests.adults > 1 || guests.children > 0 || guests.infants > 0;

  return (
    <SearchContext.Provider
      value={{
        location,
        dateRange,
        guests,
        setLocation,
        setDateRange,
        setGuests,
        clearAll,
        hasSelection,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}

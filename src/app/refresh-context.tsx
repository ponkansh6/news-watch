"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type RefreshContextValue = {
  isRefreshing: boolean;
  setRefreshing: (v: boolean) => void;
  isFiltering: boolean;
  setFiltering: (v: boolean) => void;
};

const RefreshContext = createContext<RefreshContextValue>({
  isRefreshing: false,
  setRefreshing: () => {},
  isFiltering: false,
  setFiltering: () => {},
});

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [isRefreshing, setRefreshing] = useState(false);
  const [isFiltering, setFiltering] = useState(false);
  return (
    <RefreshContext.Provider value={{ isRefreshing, setRefreshing, isFiltering, setFiltering }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}

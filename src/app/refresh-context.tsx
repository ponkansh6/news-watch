"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type RefreshContextValue = {
  isRefreshing: boolean;
  setRefreshing: (v: boolean) => void;
};

const RefreshContext = createContext<RefreshContextValue>({
  isRefreshing: false,
  setRefreshing: () => {},
});

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [isRefreshing, setRefreshing] = useState(false);
  return (
    <RefreshContext.Provider value={{ isRefreshing, setRefreshing }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}

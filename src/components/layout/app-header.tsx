"use client";

import Link from "next/link";
import { AppNav, AppNavMobile } from "./app-nav";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-7 sm:px-6 lg:px-8">
        <Link href="/" className="group flex shrink-0 flex-col leading-none text-foreground">
          <span className="font-semibold tracking-[-0.04em]">News Watch</span>
          <span className="mt-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
            Research desk
          </span>
        </Link>
        <AppNav />
        <div className="ml-auto flex items-center gap-1">
          <AppNavMobile />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Newspaper, Bookmark, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "ニュース", icon: Newspaper },
  { href: "/bookmarks", label: "ブックマーク", icon: Bookmark },
  { href: "/admin/db", label: "DB", icon: Database, prefetch: false },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="メインナビゲーション"
      className="hidden md:flex h-full items-center gap-5 border-l border-border pl-6"
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={item.prefetch ?? true}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex h-full items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppNavMobile() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 md:hidden" aria-label="メインナビゲーション">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={item.prefetch ?? true}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex size-11 items-center justify-center border-b-2 transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}

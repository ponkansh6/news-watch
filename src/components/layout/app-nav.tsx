"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Newspaper, Bookmark, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";

const navItems = [
  { href: "/", label: "ニュース", icon: Newspaper },
  { href: "/bookmarks", label: "ブックマーク", icon: Bookmark },
  { href: "/admin/db", label: "DB", icon: Database, prefetch: false },
];

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav className="hidden md:flex items-center gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.prefetch ?? true}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="md:hidden ml-auto">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="メニューを開く">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[240px] sm:w-[300px]">
            <SheetTitle className="sr-only">ナビゲーションメニュー</SheetTitle>
            <div className="flex flex-col gap-4 py-4">
              <Link href="/" className="font-bold text-lg px-2 mb-2" onClick={() => setOpen(false)}>
                News Watch
              </Link>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={item.prefetch ?? true}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

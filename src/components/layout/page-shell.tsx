import * as React from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: "default" | "wide";
  className?: string;
}

export function PageShell({
  title,
  description,
  actions,
  children,
  width = "default",
  className,
}: PageShellProps) {
  return (
    <main
      className={cn(
        "mx-auto w-full space-y-7 px-4 py-8 sm:px-6 sm:py-10 lg:px-8",
        width === "wide" ? "max-w-6xl" : "max-w-4xl",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            {title && (
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-[2.1rem]">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

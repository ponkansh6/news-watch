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
        "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 space-y-6",
        width === "wide" ? "max-w-7xl" : "max-w-4xl",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            )}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

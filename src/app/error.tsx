"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/page-shell";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title="エラーが発生しました">
      <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 space-y-4">
        <p className="text-sm text-destructive">
          予期せぬエラーが発生しました。もう一度お試しください。
        </p>
        {process.env.NODE_ENV === "development" && (
          <pre className="text-xs bg-background/80 p-3 rounded border border-border overflow-auto font-mono text-destructive">
            {error.message}
          </pre>
        )}
        <Button onClick={() => reset()} variant="destructive">
          再試行する
        </Button>
      </div>
    </PageShell>
  );
}

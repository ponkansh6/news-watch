"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/page-shell";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title="エラーが発生しました">
      <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 space-y-4">
        <p className="text-sm text-destructive">
          データベースの読み込み中にエラーが発生しました。もう一度お試しください。
        </p>
        <Button onClick={() => reset()} variant="destructive">
          再試行する
        </Button>
      </div>
    </PageShell>
  );
}

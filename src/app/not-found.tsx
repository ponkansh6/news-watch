import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/layout/page-shell";

export default function NotFound() {
  return (
    <PageShell title="ページが見つかりません">
      <div className="rounded-lg border border-border bg-card p-12 text-center space-y-4">
        <p className="text-sm text-muted-foreground">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <div>
          <Button asChild>
            <Link href="/">ホームに戻る</Link>
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

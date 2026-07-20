import { getHatenaFeeds } from "@/lib/db/actions";
import Link from "next/link";
import FeedDashboard from "./feed-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardFeedsPage() {
  const feeds = await getHatenaFeeds();

  const stats = feeds.reduce(
    (acc, feed) => {
      acc[feed.status]++;
      return acc;
    },
    { active: 0, inactive: 0, error: 0 },
  );

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Hatena Feeds Dashboard</h1>
        <Link href="/" className="text-blue-500 hover:underline">
          ← Back to Home
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="text-sm text-green-600">Active</div>
          <div className="text-2xl font-bold text-green-700">{stats.active}</div>
        </div>
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="text-sm text-gray-600">Inactive</div>
          <div className="text-2xl font-bold text-gray-700">{stats.inactive}</div>
        </div>
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="text-sm text-red-600">Error</div>
          <div className="text-2xl font-bold text-red-700">{stats.error}</div>
        </div>
      </div>

      <FeedDashboard feeds={feeds} />
    </main>
  );
}

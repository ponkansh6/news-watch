"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { hatenaFeeds } from "@/lib/db/schema";

type Feed = typeof hatenaFeeds.$inferSelect;

export default function FeedDashboard({ feeds }: { feeds: Feed[] }) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleReactivate = async (id: number) => {
    setLoadingId(id);
    try {
      const res = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        alert("Failed to reactivate feed");
      }
    } catch (err) {
      alert("An error occurred");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th className="px-4 py-3">Domain</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Bookmarks</th>
            <th className="px-4 py-3">Errors</th>
            <th className="px-4 py-3">Last Fetched</th>
            <th className="px-4 py-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {feeds.map((feed) => (
            <tr key={feed.id} className="bg-white border-b hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">{feed.domain}</td>
              <td className="px-4 py-3">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    feed.status === "active"
                      ? "bg-green-100 text-green-800"
                      : feed.status === "error"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {feed.status}
                </span>
              </td>
              <td className="px-4 py-3">{feed.bookmarkCount}</td>
              <td className="px-4 py-3">{feed.errorCount}</td>
              <td className="px-4 py-3">
                {feed.lastFetchedAt ? new Date(feed.lastFetchedAt).toLocaleString() : "Never"}
              </td>
              <td className="px-4 py-3">
                {(feed.status === "error" || feed.status === "inactive") && (
                  <button
                    onClick={() => handleReactivate(feed.id)}
                    disabled={loadingId === feed.id}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {loadingId === feed.id ? "..." : "Reactivate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

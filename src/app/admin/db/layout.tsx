export const metadata = {
  title: "Admin DB — News Watch",
  robots: "noindex",
};

export default function AdminDbLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <a href="/" className="text-neutral-500 hover:text-neutral-900 text-sm font-medium">
            ← Home
          </a>
          <span className="text-neutral-300">/</span>
          <a href="/admin/db" className="font-bold text-lg text-neutral-900 tracking-tight">
            Admin DB
          </a>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

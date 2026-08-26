import Link from "next/link";
import { Users, LayoutDashboard, CalendarDays, Settings, Trophy } from "lucide-react";

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-gray-200 dark:border-zinc-800">
          <Trophy className="w-6 h-6 text-blue-600 mr-2" />
          <span className="font-bold text-lg tracking-tight">SportsOps</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            <li>
              <Link href="/admin" className="flex items-center px-3 py-2 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <LayoutDashboard className="w-5 h-5 mr-3" />
                Dashboard
              </Link>
            </li>
            <li>
              <Link href="/admin/players" className="flex items-center px-3 py-2 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Users className="w-5 h-5 mr-3" />
                Players & Import
              </Link>
            </li>
            <li>
              <Link href="/admin/matches" className="flex items-center px-3 py-2 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <CalendarDays className="w-5 h-5 mr-3" />
                Match Management
              </Link>
            </li>
            <li>
              <Link href="/admin/settings" className="flex items-center px-3 py-2 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                <Settings className="w-5 h-5 mr-3" />
                Event Settings
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Mobile Header */}
        <header className="h-16 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 flex items-center px-4 md:hidden">
          <Trophy className="w-6 h-6 text-blue-600 mr-2" />
          <span className="font-bold text-lg">SportsOps</span>
        </header>
        
        <div className="p-6 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

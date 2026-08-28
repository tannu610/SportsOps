import { Trophy } from "lucide-react";

export default function PlayerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col max-w-md mx-auto shadow-2xl relative">
      <header className="h-16 bg-blue-600 text-white flex items-center justify-between px-4 sticky top-0 z-10 shadow-md">
        <a href="/player/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
          <Trophy className="w-5 h-5 mr-2" />
          <span className="font-bold tracking-tight">Sports Day 2026</span>
        </a>
      </header>
      
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

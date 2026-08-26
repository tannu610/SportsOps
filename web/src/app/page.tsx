import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 gap-8 sm:p-20 font-sans text-center">
      <main className="flex flex-col gap-8 items-center max-w-2xl">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Sports Event Match-Day Operations
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          A real-time attendance and match communication system for corporate sports events.
        </p>
        
        <div className="flex gap-4 items-center flex-col sm:flex-row mt-8">
          <Link
            className="rounded-full border border-solid border-transparent transition-colors flex items-center justify-center bg-blue-600 text-white gap-2 hover:bg-blue-700 text-sm sm:text-base h-12 px-8 font-medium w-full sm:w-auto"
            href="/admin"
          >
            Committee Dashboard
          </Link>
          <Link
            className="rounded-full border border-solid border-black/[.08] dark:border-white/[.145] transition-colors flex items-center justify-center hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] hover:border-transparent text-sm sm:text-base h-12 px-8 font-medium w-full sm:w-auto"
            href="/player/check-in"
          >
            Player Check-in
          </Link>
        </div>
      </main>
    </div>
  );
}

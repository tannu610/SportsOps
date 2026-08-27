# Sports Event Match-Day Operations System (V1) - Project Status

## ✅ What Has Been Completed

### 1. Infrastructure & Architecture
- [x] Initialized **Next.js (App Router)** workspace with Tailwind CSS.
- [x] Drafted and executed **Supabase PostgreSQL Schema** (`events`, `players`, `matches`).
- [x] Connected the Next.js frontend to the live Supabase database via environment variables.

### 2. Committee Admin Dashboard (`/admin`)
- [x] **Live Stats Dashboard:** Displays real-time aggregate counts for Total Registered, Present Today, Live Matches, and Action Required (No-Show Pending).
- [x] **Live Courts View:** Displays matches currently happening on courts or matches with pending No-Shows.
- [x] **Player Excel/CSV Import (`/admin/players`):** Parses MS Teams Forms exports directly in the browser, validates missing data, handles duplicate IDs, and securely inserts clean data into Supabase.
- [x] **Match Management (`/admin/matches`):** 
  - Dynamic "Create Match" modal that fetches imported players.
  - Interactive state-machine buttons to move a match through states: `SCHEDULED` ➡️ `LIVE` ➡️ `COMPLETED` or `NO-SHOW PENDING` ➡️ `WALKOVER` / `DELAYED`.
  - **Manual WhatsApp Integration:** Auto-generates pre-filled WhatsApp links for committee members to quickly remind players or warn them about walkovers.

### 3. Player Mobile Experience (`/player`)
- [x] **Mobile Check-In (`/player/check-in`):** Allows players to scan a static venue QR code, enter their Employee ID and Mobile Number, and successfully flip their database status to `PRESENT`.
- [x] **Dynamic Player Dashboard (`/player/dashboard`):** 
  - Fetches the exact player profile and their next scheduled match.
  - Interactive Action Buttons allowing the player to acknowledge a match (`I'M COMING`) or reject it (`I'M UNAVAILABLE`).
  - **Web Push Notifications UI:** Includes a native browser prompt for players to opt-in to Push Notifications.


---

## ⏳ What is Pending / To-Do

### 1. Security & Authentication (Critical for Launch)
- [x] **Admin Route Protection:** Implemented Supabase Auth and Next.js Middleware (`src/proxy.ts`) to ensure only authorized committee members can access `/admin`.

### 2. Native Web Push Notifications Implementation
- [x] **Service Worker Setup (`next-pwa`):** Implemented custom service worker (`worker/index.ts`) and configured `@ducanh2912/next-pwa`. Set up `/api/push/subscribe` route to handle saving subscriptions and added VAPID keys.

### 3. Hosting & Deployment
- [ ] **Vercel Deployment:** Push the local codebase to a GitHub repository and connect it to Vercel so the application is publicly accessible via the internet on mobile devices.

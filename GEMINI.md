# Sports Event Match-Day Operations System (V1) - Project Rules & Context

## Project Overview
This project is a match-day operations and communication layer built on top of an existing Microsoft Teams Forms registration process. The primary objective is to reduce manual coordination, repeated microphone announcements, uncertainty around player attendance, and delays caused by players not knowing when/where they need to report.

## Core V1 Workflow
1. **Registration Import:** Excel/CSV upload from existing MS Teams Forms.
2. **Match-Day Check-In:** Live attendance tracking (QR or manual).
3. **Match Management:** Committee manually creates matches and assigns courts/times.
4. **Player Notifications:** Automatic notifications to players (Push/Web).
5. **Player Acknowledgement:** "I'm coming" / "Unavailable".
6. **No-Show Workflow:** Grace periods and committee actions (Walkover/Reschedule).
7. **Live Dashboard:** Committee monitors real-time match and attendance statuses.

## Important Constraints (Out of Scope for V1)
- **NO** automatic fixture generation.
- **NO** skill-based or AI matchmaking.
- **NO** tournament bracket generation or full tournament management.
- **NO** automatic replacement of players.
- **NO** automatic Walkover assignment (must be Committee driven).
- **Keep V1 simple:** "Automate communication and visibility first. Do not automate tournament decisions yet."

## Technical Guidelines
- **Architecture:** Mobile-first web application (PWA recommended for notifications).
- **Security:** Role-based access (Committee/Admin vs Player). Ensure Employee ID and contact info are secure.
- **Player States:** `REGISTERED`, `PRESENT`, `AVAILABLE`, `CALLED`, `PLAYING`, `COMPLETED`, `ABSENT`, `UNAVAILABLE`, `NO_SHOW`.
- **Match States:** `SCHEDULED`, `NOTIFIED`, `PLAYER_CONFIRMED`, `READY`, `LIVE`, `COMPLETED`, `DELAYED`, `NO_SHOW_PENDING`, `WALKOVER`, `CANCELLED`.
- Prioritize real-time updates for dashboards and player views without requiring page refreshes.

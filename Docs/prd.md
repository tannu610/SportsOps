# Sports Event Match-Day Operations System — V1

## Product Overview
The Sports Committee organizes corporate sports events multiple times a year.
The current process works reasonably well for registration, but significant operational chaos occurs on the actual match day.
The committee already collects player registrations through Microsoft Teams Forms. The registration process includes details such as:
- Employee ID
- Employee name
- Contact information
- Sport
- Match/category
- Transport requirement
- Other event-specific registration information
- Give a button to add any new field or delete the existing field

This existing registration process should remain unchanged for V1.
The proposed V1 application will operate as a match-day operations and communication layer on top of the existing registration process.
The primary objective is to reduce manual coordination, repeated microphone announcements, uncertainty around player attendance, and delays caused by players not knowing when or where they need to report.

## Problem Statement
During sports events, the committee faces several recurring problems:

### 2.1 Uncertainty about attendance
The registration list contains everyone who registered, but the committee does not have a reliable real-time view of who has actually arrived at the venue.
*For example:* 64 players may be registered, but only 50 may actually be present.
The committee currently has to determine this manually.

### 2.2 Manual player announcements
When a match is scheduled, committee members repeatedly announce players over the microphone.
*For example:* «Rahul and Amit, please report to Court 2.»
This becomes increasingly difficult when there are many matches and multiple courts.

### 2.3 Players do not always know when they need to report
A player may not know:
- When their match is scheduled
- Which court they need to report to
- How much time they have before the match
- Whether their match has been delayed
- Whether the court has changed

### 2.4 No-show handling is manual
If a player does not report, committee members need to:
- Find out whether the player is present
- Make another announcement
- Wait for the player
- Track the grace period
- Decide whether the player should be considered a no-show
- Potentially award a walkover

### 2.5 Committee members have to coordinate everything manually
The committee currently acts as:
- Attendance tracker
- Match announcer
- Player locator
- Reminder system
- No-show tracker
- Match-status tracker

The V1 application should reduce this manual workload.

## V1 Objective
The objective of V1 is:
> «To provide the sports committee with a real-time attendance and match communication system that automatically informs players about their scheduled matches and allows the committee to monitor player availability and reporting status without relying primarily on microphone announcements.»

The system should make the committee a supervisor of the event rather than the communication engine of the event.

## V1 Scope
V1 WILL include:
1. Importing existing registration data and can add or delete into the data using the UI
2. Event/player management
3. Player identification
4. Match-day check-in
5. Real-time attendance status
6. Manual match creation
7. Court and match-time assignment
8. Player match notifications
9. Player acknowledgement
10. Automated reminders
11. No-show workflow
12. Walkover confirmation
13. Real-time committee dashboard
14. Basic match status tracking
15. Notification history/audit trail

## Explicitly Out of Scope for V1
The following must NOT be built as part of V1:
- Automatic fixture generation
- Skill-based matchmaking
- AI matchmaking
- Automatic tournament bracket generation
- Automatic knockout progression
- Player ranking algorithm
- Tournament optimization
- Automatic replacement of players
- Full tournament management
- Transport management
- Registration form creation
- Replacement of Microsoft Teams Forms
- Complex player statistics
- Leaderboards
- Advanced analytics

These may be considered for future versions.

## Existing Registration Process
The existing registration process should remain unchanged.
The organization currently uses Microsoft Teams Forms to collect registrations.
Typical registration information includes:
- Employee ID
- Employee name
- Contact information
- Sport
- Match/category
- Transport requirement
- Other event-specific fields

The application should consume this information rather than replace the registration process.

## V1 Import Method
The initial implementation should support **Excel/CSV upload**.
The committee should be able to export the Teams Form responses and upload the file into the application.

*Example Workflow:*
```text
Microsoft Teams Form
        ↓
Form Responses
        ↓
Excel/CSV
        ↓
Sports Event System
```

The system should validate imported data and identify:
- Duplicate employee IDs
- Missing mandatory information
- Invalid contact information
- Duplicate players
- Unsupported categories

*Example import result:*
> 64 records received
> 62 imported successfully
> 1 duplicate Employee ID
> 1 missing contact information

## User Roles
V1 should have two primary user types.

### Committee/Admin
The committee can:
- Create/manage an event
- Import players
- Add new players into the database from the UI or delete the existing players from the database from the UI
- View attendance
- View player status
- Create matches
- Assign players
- Assign court
- Assign reporting time
- Assign match time
- Send/re-send notifications
- View player acknowledgement
- Mark player as reported
- Mark player as no-show
- Confirm walkover
- Change match status
- Modify match details
- Override system status when required

### Player
The player can:
- Access their event profile
- Check in
- View current status
- View upcoming match
- View opponent
- View court
- View reporting time
- View match time
- Receive notifications
- Confirm that they are coming
- Indicate that they are unavailable
- View basic match history

## Player Identity
Employee ID should be the primary unique identifier for a player.
Phone number/email should be treated as communication information rather than the primary identity.

*Example:*
- **Employee ID:** EMP12345
- **Player ID:** SP26-0045
- **Name:** Rahul Sharma

A player should have a unique identifier within the system. The system may generate a QR code associated with the player ID. The QR code must not expose sensitive personal information.

## Event Creation
The committee should be able to create an event.
Required information:
- Event name
- Sport
- Event date
- Venue
- Number of courts/playing areas

*Example:*
- **Event:** Annual Sports Day 2026
- **Sport:** Badminton
- **Date:** 15 September 2026
- **Venue:** XYZ Sports Complex
- **Courts:** 4

## Attendance / Check-In
Attendance is one of the primary features of V1. When a player arrives at the venue, they should be able to check in.
- **Preferred mechanism:** QR code scan
- **Alternative:** Employee ID / Player ID search

*After successful check-in:*
```text
Player
   ↓
CHECKED IN
   ↓
PRESENT
```
The committee dashboard should update in real time.
*Example:*
- Registered: 64
- Present: 51
- Absent: 13

## Player Status Model
The system should maintain a clear player status.
Recommended states:
- `REGISTERED`
- `PRESENT`
- `AVAILABLE`
- `CALLED`
- `PLAYING`
- `COMPLETED`
- `ABSENT`
- `UNAVAILABLE`
- `NO_SHOW`

The system must prevent contradictory states where possible.
*Example:* A player who is currently playing should not simultaneously appear as Available.

## Committee Attendance Dashboard
The committee should have a live view of all players.

*Example:*
| PLAYER | STATUS |
|---|---|
| Rahul | 🟢 Available |
| Amit | 🔴 Playing |
| Neha | 🟡 Called |
| Priya | 🟢 Available |
| Karan | ⚫ Absent |

The committee should be able to filter by:
- Sport
- Category
- Status
- Employee ID
- Player name

The dashboard should also display summary counts:
- Registered: 64
- Present: 51
- Available: 18
- Called: 4
- Playing: 8
- Completed: 21
- Absent: 13

## Manual Match Creation
V1 will NOT generate fixtures automatically. The committee will continue deciding who plays whom. The application simply digitizes the operational side of the fixture.

The committee should be able to create a match manually.
Required fields:
- Player 1
- Player 2
- Court
- Reporting time
- Scheduled match time
- Sport/category

*Example:*
> **Match #024**
> Player 1: Rahul Sharma
> Player 2: Amit Kumar
> Court: Court 2
> Report by: 15:20
> Match: 15:30

Once the match is created, the notification workflow begins automatically.

## Match Status
Recommended match states:
- `SCHEDULED`
- `NOTIFIED`
- `PLAYER_CONFIRMED`
- `READY`
- `LIVE`
- `COMPLETED`
- `DELAYED`
- `NO_SHOW_PENDING`
- `WALKOVER`
- `CANCELLED`

The system should maintain timestamps for important state changes.

## Player Notification System
This is the core feature of V1. Whenever a match is assigned to a player, the system should notify that player.
The notification should contain:
- Player name
- Opponent
- Sport
- Court
- Reporting time
- Match time
- Relevant instructions

*Example:*
> 🏸 **Match Scheduled**
> Your match: Rahul Sharma vs Amit Kumar
> Court: 2
> Report by: 3:20 PM
> Match time: 3:30 PM
> Please report to Court 2 by 3:20 PM.

## Player Acknowledgement
The player should be able to acknowledge the notification.
Minimum actions:
- `[ I’M COMING ]`
- `[ I’M UNAVAILABLE ]`

If the player selects **I’M COMING**, the committee dashboard should show:
> Rahul - 🟢 Confirmed

If the player selects **I’M UNAVAILABLE**, the dashboard should show:
> Rahul - 🔴 Unavailable

The system should record:
- Response
- Timestamp
- Match ID
- Player ID

## Notification Timeline
Notifications should be configurable by the committee/event administrator.
Default V1 configuration:
- **Initial notification:** Immediately after match creation.
- **Reminder 1:** 10 minutes before reporting time.
- **Reminder 2:** 5 minutes before reporting time.
- **Final call:** At reporting time.
- **No-show warning:** After the configured grace period.

The exact timing should be configurable.
*Example (Reporting time: 15:20):*
- `14:xx` - Initial notification
- `15:10` - 10-minute reminder
- `15:15` - 5-minute reminder
- `15:20` - Final call
- `15:23` - No-show eligible

## Notification Content Customization
The committee/admin should be able to configure notification messages. At minimum, the system should provide default templates.

*Examples:*
- **Match Assigned:** «Your match is scheduled. Please report to {{court}} by {{report_time}}.»
- **Reminder:** «Your match with {{opponent}} starts in {{minutes}} minutes. Please report to {{court}}.»
- **Final Call:** «Final call. Please report to {{court}} immediately.»
- **No-Show Warning:** «You have not reported for your scheduled match. Please report within {{grace_period}} minutes or the match may be declared a walkover.»
- **Walkover:** «You did not report within the permitted time. The committee has recorded the match as a walkover.»

Templates should support variables such as:
`{{player_name}}`, `{{opponent}}`, `{{court}}`, `{{report_time}}`, `{{match_time}}`, `{{minutes}}`, `{{event_name}}`

## No-Show Workflow
The system should NOT automatically award a walkover solely because the player did not acknowledge a notification.
The system should instead move the match into: `NO_SHOW_PENDING`

*Example:* Match starts at 15:30
- `15:20` - Player has not reported
- `15:20` - Final reminder
- `15:23` - Grace period reached -> System: "No-show eligible"

The committee then decides:
- `[ CONFIRM WALKOVER ]`
- `[ EXTEND GRACE PERIOD ]`
- `[ RESCHEDULE ]`
- `[ MARK PLAYER PRESENT ]`

This preserves human control.

## Real-Time Committee Match Dashboard
The committee should have a live match view.

*Example:*
> **LIVE MATCHES**
> **COURT 1**
> Rahul vs Amit
> 🟢 Both reported | LIVE
> 
> **COURT 2**
> Neha vs Priya
> 🟢 Neha | 🔴 Priya not reported | NO-SHOW PENDING
> 
> **COURT 3**
> Karan vs Mohit
> 🟡 Upcoming | Starts 15:45

The dashboard should highlight items requiring committee attention.
*Example:*
> ⚠ **ACTION REQUIRED**
> Priya has not reported. Match #024 reaches no-show status in 2 minutes.

## Court Management
V1 does not need automatic court allocation. The committee will assign the court manually.
However, the system must display:
- Court
- Current match
- Next scheduled match
- Court status

*Example:*
> **COURT 1**
> Current: Rahul vs Amit
> Status: LIVE
> Next: Neha vs Priya
> Start: 15:45

If the committee changes the court, the affected players should receive an updated notification.
*Example:* «⚠️ Court changed. Your match will now be played on Court 3.»

## Match Delay
The committee should be able to mark a match as delayed.
*Example (Match #024):*
- Original: 15:30
- New time: 15:40

Affected players should receive:
«Your match has been delayed by 10 minutes. Please remain available.»

## Real-Time Updates
Changes made by the committee should be reflected on the player’s interface without requiring the player to repeatedly refresh the page.
Examples:
- Court change
- Match delay
- Match cancellation
- Match start
- Match completion

The exact technical implementation can be decided by the development team.

## Player Mobile Interface
The player interface should be mobile-first. The player should see something similar to:

```text
SPORTS DAY 2026
Hi Rahul 👋

STATUS
🟢 Present

NEXT MATCH
Rahul Sharma Vs Amit Kumar
Court 2
Report by: 3:20 PM
Match: 3:30 PM

[ I’M COMING ]  [ I’M UNAVAILABLE ]
```

The interface should prioritize:
1. Next match
2. Court
3. Reporting time
4. Match time
5. Current status
6. Notifications

Do not overload the player interface with tournament statistics in V1.

## Committee Notification Controls
The committee should be able to:
- Send notification
- Re-send notification
- View notification status
- See whether player acknowledged
- See last notification time

*Example:*
- **Rahul:** Notification: Delivered | Acknowledged: Yes | Response time: 15:08
- **Amit:** Notification: Delivered | Acknowledged: No | Last reminder: 15:15

## Notification Delivery
The preferred V1 mechanism should be a mobile-friendly web application/PWA with push notifications.
The system should request notification permission from the player. The development team should evaluate the most reliable implementation for the organization’s environment.

Possible communication channels:
- **Primary:** Web push notification
- **Potential fallback:** Email, Microsoft Teams, SMS

The first V1 implementation should avoid unnecessary complexity. The priority is reliable match notification.

## Audit Trail
The system should maintain an event history.
*For example:*
- `15:02` - Match #024 created
- `15:02` - Notification sent to Rahul
- `15:02` - Notification sent to Amit
- `15:08` - Rahul confirmed
- `15:10` - 10-minute reminder sent
- `15:20` - Rahul reported
- `15:20` - Amit not reported
- `15:23` - No-show status triggered
- `15:24` - Committee confirmed walkover

This will be useful for troubleshooting and future analytics.

## Security and Privacy
The application will handle employee information. Minimum requirements:
- Authentication for committee/admin users
- Role-based access
- Players should only see their own information
- Players should not be able to access another player’s personal information
- Employee ID should not be unnecessarily exposed
- Contact information should not be publicly visible
- QR codes should not contain sensitive information
- HTTPS must be used
- Database access must be secured
- Administrative actions should be logged

The development team should follow the organization’s applicable IT/security requirements.

## Data Import Validation
When the committee uploads registration data, the system should validate the file.
Possible errors:
❌ Duplicate Employee ID
❌ Missing Employee ID
❌ Missing player name
❌ Invalid contact information
❌ Missing sport
❌ Missing category

The system should provide an understandable import summary.
*Example:*
> **Import completed**
> Total records: 64
> Successfully imported: 61
> Errors: 2 duplicate Employee IDs, 1 missing contact number

## V1 Acceptance Criteria
V1 should be considered successful when the following complete workflow works:

**Main Workflow:**
```text
Teams Form → Export responses → Upload Excel/CSV → Players imported → Player arrives → QR scanned → Player marked PRESENT → Committee creates match → Player receives notification → Player confirms → Reminder is sent → Player reports → Committee marks match LIVE → Match completes → Committee updates status
```

**No-Show Workflow:**
```text
Match scheduled → Player notified → Player does not report → Reminder → Final call → Grace period → Committee sees NO-SHOW PENDING → Committee confirms WALKOVER
```

## Pilot Testing Plan
Before using the system in a major company sports event, conduct a small pilot.
- **Recommended:** 10–20 players. Use one sport and a small number of courts.
- Run the system alongside the existing manual process.
- Do not remove the microphone announcements completely during the first pilot (the existing process should act as backup).

Test scenarios should include:
1. Normal check-in
2. Late arrival
3. Player does not check in
4. Match assignment
5. Player confirms attendance
6. Player does not respond
7. Player says unavailable
8. Court change
9. Match delay
10. Player no-show
11. Walkover
12. Notification failure
13. Multiple simultaneous matches

## V1 Success Metrics
The project should be evaluated using measurable outcomes.

| Metric | Target |
|---|---|
| Successful player check-ins | >95% |
| Match notifications delivered | >95% |
| Players acknowledging matches | >80% |
| Matches requiring microphone announcement | <20% |
| No-show detection | Within configured grace period |
| Committee manual coordination | Significantly reduced |
| Players missing matches due to communication failure | Near zero |

The most important metric is: **«Reduction in manual match announcements and player coordination.»**

## Recommended Development Phases

### Phase 1 — Foundation
- Project setup
- Authentication
- Database
- Event model
- Player model
- Admin interface

### Phase 2 — Registration Import
- Excel/CSV upload
- Validation
- Player import
- Duplicate detection

### Phase 3 — Attendance
- QR generation
- QR scanning
- Check-in
- Player status
- Live attendance dashboard

### Phase 4 — Match Management
- Create match
- Assign players
- Assign court
- Assign reporting time
- Assign match time
- Match status

### Phase 5 — Player Interface
- Mobile player dashboard
- Current status
- Upcoming match
- Court
- Reporting time
- Match information

### Phase 6 — Notification Engine
- Match notification
- Push notification
- Reminder scheduler
- Final call
- Notification history
- Message templates

### Phase 7 — No-Show Management
- Grace period
- No-show pending
- Committee confirmation
- Walkover
- Reschedule option

### Phase 8 — Real-Time Operations
- Live committee dashboard
- Real-time status changes
- Court changes
- Match delays
- Player updates

### Phase 9 — Pilot
- Demo event
- Internal testing
- 10–20 player pilot
- Feedback
- Bug fixing
- Reliability improvements

## V1 Technical Principle
The development team should follow one important principle:
> **«Automate communication and visibility first. Do not automate tournament decisions yet.»**

The committee should remain responsible for:
- Who plays whom
- Fixture decisions
- Court assignment
- Rescheduling
- Walkover confirmation
- Exceptional cases

The application should handle:
- Who is present
- Who needs to play
- Who has been notified
- Who acknowledged
- Who has reported
- Who needs a reminder
- Who has not reported
- What requires committee attention

This separation keeps V1 simple, reliable, and easy to test.

## Future Roadmap
Once V1 has been successfully tested in multiple events, the next versions can build on the same foundation.

**V2 — Smart Scheduling**
Add: Player skill categories, Participation balancing, Previous opponents, Match history, Smart fixture recommendations, Court optimization, Dynamic rescheduling

**V3 — Tournament Management**
Add: Automated brackets, Knockout progression, Tournament rules, Results, Leaderboards, Player statistics

**V4 — Intelligence & Analytics**
Add: Historical player performance, Event analytics, Participation analytics, Court utilization, Match duration analysis, No-show patterns, Scheduling recommendations

The existing V1 attendance, player, match, and notification data should be designed so that it can support these future versions without requiring a complete rebuild.

## Final V1 Product Definition
**Product:** Sports Event Match-Day Operations System

**V1 purpose:**
«Provide a real-time digital layer for attendance, match communication, player acknowledgement, reminders, and no-show management while preserving the organization’s existing Microsoft Teams registration and manual fixture-generation process.»

**Primary problem solved:**
«Reduce match-day chaos caused by uncertainty around player attendance, repeated announcements, players missing their matches, and manual no-show coordination.»

**Core V1 workflow:**
```text
Existing Teams Registration
          ↓
Excel/CSV Import
          ↓
Player Database
          ↓
Match-Day Check-In
          ↓
Live Attendance
          ↓
Committee Creates Match
          ↓
Automatic Player Notification
          ↓
Player Acknowledgement
          ↓
Automated Reminders
          ↓
Player Reports
          ↓
Match Status
          ↓
No-Show / Walkover Workflow
          ↓
Live Committee Dashboard
```

V1 should be considered complete when the committee can run a real sports event with substantially fewer microphone announcements and substantially less manual effort spent locating and reminding players.

-- V2 Database Schema
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sport TEXT,
  event_date DATE,
  venue TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sport TEXT,
  contact_info TEXT,
  status TEXT DEFAULT 'REGISTERED',
  check_in_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  UNIQUE(event_id, employee_id)
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  sport TEXT NOT NULL DEFAULT 'Other',
  category TEXT DEFAULT 'NA',
  team1_p1_id UUID REFERENCES players(id) ON DELETE SET NULL,
  team1_p2_id UUID REFERENCES players(id) ON DELETE SET NULL,
  team2_p1_id UUID REFERENCES players(id) ON DELETE SET NULL,
  team2_p2_id UUID REFERENCES players(id) ON DELETE SET NULL,
  playing_area TEXT,
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  reporting_time TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'SCHEDULED',
  winner_id UUID REFERENCES players(id) ON DELETE SET NULL,
  score TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  read BOOLEAN DEFAULT FALSE
);

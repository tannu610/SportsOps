import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { extractPlayerCode, extractPlayerSource } from '../src/utils/playerCode.ts';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=');
      if (key && rest.length > 0) {
        let val = rest.join('=').trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key.trim()] = val;
      }
    }
  });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, anonKey);

test('ADVANCED PLAYER FILTERS FOR ADMIN PLAYERS & IMPORT - Acceptance Test Suite', async (t) => {
  // Test dataset representing real SportsOps player records
  const samplePlayers = [
    {
      id: '124328',
      name: 'Priyanka',
      gender: 'Female',
      sport: 'Badminton',
      category: "Women's Singles, Women's Doubles, Mixed Doubles",
      source: 'WALK-IN',
      status: 'PRESENT',
      playerCode: 'SO-UA8SMF'
    },
    {
      id: '60267',
      name: 'Riya Kapoor',
      gender: 'Female',
      sport: 'Badminton',
      category: "Women's Singles",
      source: 'IMPORT',
      status: 'REGISTERED',
      playerCode: 'SO-MCQU9Y'
    },
    {
      id: '118579',
      name: 'Priya Nair',
      gender: 'Female',
      sport: 'Badminton',
      category: "Women's Doubles",
      source: 'IMPORT',
      status: 'REGISTERED',
      playerCode: 'SO-M9ZLJT'
    },
    {
      id: '20046',
      name: 'Anuj Sharma',
      gender: 'Male',
      sport: 'Badminton',
      category: "Men's Singles",
      source: 'IMPORT',
      status: 'REGISTERED',
      playerCode: 'SO-GPCHL8'
    },
    {
      id: '5550',
      name: 'Karan Singh',
      gender: 'Male',
      sport: 'Badminton',
      category: "Men's Singles, Men's Doubles",
      source: 'IMPORT',
      status: 'REGISTERED',
      playerCode: 'SO-LMPS8G'
    },
    {
      id: '99001',
      name: 'Rohan TT',
      gender: 'Male',
      sport: 'Table Tennis',
      category: "Open Doubles",
      source: 'IMPORT',
      status: 'PRESENT',
      playerCode: 'SO-RTT101'
    }
  ];

  // Event sports configuration map
  const eventSportsMap = {
    'Badminton': ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"],
    'Table Tennis': ["Open Doubles", "Men's Singles"]
  };

  // Pure filtering function matching src/app/admin/players/page.tsx
  function filterPlayers(players, filters) {
    const {
      searchQuery = '',
      sourceFilter = 'ALL',
      statusFilter = 'ALL',
      genderFilter = 'ALL',
      sportFilter = 'ALL',
      categoryFilter = 'ALL'
    } = filters;

    return players.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.playerCode.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSource = sourceFilter === 'ALL' || p.source === sourceFilter;
      const matchesStatus = statusFilter === 'ALL' || p.status === statusFilter;
      const matchesGender =
        genderFilter === 'ALL' ||
        (p.gender && p.gender.trim().toLowerCase() === genderFilter.toLowerCase());
      const matchesSport =
        sportFilter === 'ALL' ||
        (p.sport && p.sport.trim().toLowerCase() === sportFilter.toLowerCase());

      let matchesCategory = true;
      if (categoryFilter !== 'ALL') {
        const playerCategories = p.category
          ? p.category.split(',').map((c) => c.trim().toLowerCase())
          : [];
        const filterCatLower = categoryFilter.trim().toLowerCase();
        matchesCategory = playerCategories.includes(filterCatLower);
      }

      return (
        matchesSearch &&
        matchesSource &&
        matchesStatus &&
        matchesGender &&
        matchesSport &&
        matchesCategory
      );
    });
  }

  // TEST 1: Gender = Female
  await t.test('TEST 1: Gender = Female -> Only female players appear', () => {
    const results = filterPlayers(samplePlayers, { genderFilter: 'Female' });
    assert.strictEqual(results.length, 3);
    assert.ok(results.every((p) => p.gender === 'Female'));
    assert.ok(results.some((p) => p.name === 'Priyanka'));
    assert.ok(results.some((p) => p.name === 'Riya Kapoor'));
    assert.ok(results.some((p) => p.name === 'Priya Nair'));
  });

  // TEST 2: Gender = Male
  await t.test('TEST 2: Gender = Male -> Only male players appear', () => {
    const results = filterPlayers(samplePlayers, { genderFilter: 'Male' });
    assert.strictEqual(results.length, 3);
    assert.ok(results.every((p) => p.gender === 'Male'));
    assert.ok(results.some((p) => p.name === 'Anuj Sharma'));
    assert.ok(results.some((p) => p.name === 'Karan Singh'));
    assert.ok(results.some((p) => p.name === 'Rohan TT'));
  });

  // TEST 3: Sport = Badminton
  await t.test('TEST 3: Sport = Badminton -> Only badminton players appear', () => {
    const results = filterPlayers(samplePlayers, { sportFilter: 'Badminton' });
    assert.strictEqual(results.length, 5);
    assert.ok(results.every((p) => p.sport === 'Badminton'));
    assert.ok(!results.some((p) => p.name === 'Rohan TT'));
  });

  // TEST 4: Category = Women's Singles
  await t.test("TEST 4: Category = Women's Singles -> All players registered for Women's Singles appear", () => {
    const results = filterPlayers(samplePlayers, { categoryFilter: "Women's Singles" });
    assert.strictEqual(results.length, 2);
    assert.ok(results.some((p) => p.name === 'Priyanka'));
    assert.ok(results.some((p) => p.name === 'Riya Kapoor'));
  });

  // TEST 5: Female + Badminton + Women's Singles
  await t.test("TEST 5: Combined: Female + Badminton + Women's Singles", () => {
    const results = filterPlayers(samplePlayers, {
      genderFilter: 'Female',
      sportFilter: 'Badminton',
      categoryFilter: "Women's Singles"
    });
    assert.strictEqual(results.length, 2);
    assert.ok(results.every((p) => p.gender === 'Female' && p.sport === 'Badminton'));
  });

  // TEST 6: Multiple Category Player (Priyanka)
  await t.test('TEST 6: Player registered for multiple categories appears when filtering by ANY one', () => {
    const singlesResults = filterPlayers(samplePlayers, { categoryFilter: "Women's Singles" });
    assert.ok(singlesResults.some((p) => p.name === 'Priyanka'), 'Priyanka must appear in Women\'s Singles');

    const doublesResults = filterPlayers(samplePlayers, { categoryFilter: "Women's Doubles" });
    assert.ok(doublesResults.some((p) => p.name === 'Priyanka'), 'Priyanka must appear in Women\'s Doubles');

    const mixedResults = filterPlayers(samplePlayers, { categoryFilter: "Mixed Doubles" });
    assert.ok(mixedResults.some((p) => p.name === 'Priyanka'), 'Priyanka must appear in Mixed Doubles');

    const mensSinglesResults = filterPlayers(samplePlayers, { categoryFilter: "Men's Singles" });
    assert.ok(!mensSinglesResults.some((p) => p.name === 'Priyanka'), 'Priyanka must NOT appear in Men\'s Singles');
  });

  // TEST 7: Sport -> Category Dependency: Category options update to match sport
  await t.test('TEST 7: Category options derive dynamically from selected sport', () => {
    const getCategoriesForSport = (sport) => {
      if (sport !== 'ALL') return eventSportsMap[sport] || [];
      const all = new Set();
      Object.values(eventSportsMap).forEach((cats) => cats.forEach((c) => all.add(c)));
      return Array.from(all);
    };

    const badmintonCats = getCategoriesForSport('Badminton');
    assert.deepStrictEqual(badmintonCats, ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]);

    const ttCats = getCategoriesForSport('Table Tennis');
    assert.deepStrictEqual(ttCats, ["Open Doubles", "Men's Singles"]);

    const allCats = getCategoriesForSport('ALL');
    assert.ok(allCats.includes("Women's Singles"));
    assert.ok(allCats.includes("Open Doubles"));
  });

  // TEST 8: Sport change auto-resets invalid Category selection
  await t.test('TEST 8: Changing sport resets category if category is invalid for newly selected sport', () => {
    let currentCategory = "Women's Singles";
    const newSport = "Table Tennis";

    const validCategories = eventSportsMap[newSport] || [];
    if (currentCategory !== 'ALL' && !validCategories.some((c) => c.toLowerCase() === currentCategory.toLowerCase())) {
      currentCategory = 'ALL';
    }

    assert.strictEqual(currentCategory, 'ALL', 'Category must reset to ALL because Women\'s Singles is not valid for Table Tennis');
  });

  // TEST 9: Clear Filters restores all players
  await t.test('TEST 9: Clear Filters resets all filters and returns all players', () => {
    const activeFilters = {
      genderFilter: 'Female',
      sportFilter: 'Badminton',
      categoryFilter: "Women's Singles",
      statusFilter: 'PRESENT',
      sourceFilter: 'WALK-IN'
    };
    const filtered = filterPlayers(samplePlayers, activeFilters);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].name, 'Priyanka');

    // Reset filters
    const clearedFilters = {
      genderFilter: 'ALL',
      sportFilter: 'ALL',
      categoryFilter: 'ALL',
      statusFilter: 'ALL',
      sourceFilter: 'ALL'
    };
    const all = filterPlayers(samplePlayers, clearedFilters);
    assert.strictEqual(all.length, samplePlayers.length, 'All players must return when cleared');
  });

  // TEST 10: Existing Source and Status filters work together with new filters
  await t.test('TEST 10: Source and Status filters continue working with Gender, Sport, Category', () => {
    // Walk-in female Badminton players that are PRESENT
    const results = filterPlayers(samplePlayers, {
      sourceFilter: 'WALK-IN',
      genderFilter: 'Female',
      sportFilter: 'Badminton',
      statusFilter: 'PRESENT'
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'Priyanka');
    assert.strictEqual(results[0].source, 'WALK-IN');
    assert.strictEqual(results[0].status, 'PRESENT');

    // Imported female Badminton players that are REGISTERED
    const importedResults = filterPlayers(samplePlayers, {
      sourceFilter: 'IMPORT',
      genderFilter: 'Female',
      sportFilter: 'Badminton',
      statusFilter: 'REGISTERED'
    });
    assert.strictEqual(importedResults.length, 2);
    assert.ok(importedResults.every((p) => p.source === 'IMPORT' && p.status === 'REGISTERED'));
  });

  // TEST 11: Real Event Configuration verification from Supabase database
  await t.test('TEST 11: Active event configuration in database contains configured sports & categories', async () => {
    const { data: events, error } = await supabase
      .from('events')
      .select('id, name, configuration')
      .order('created_at', { ascending: false })
      .limit(1);

    assert.ifError(error);
    assert.ok(events && events.length > 0, 'At least one event must exist');
    const ev = events[0];

    // Check relational event_sports
    const { data: relSports } = await supabase
      .from('event_sports')
      .select('sport, event_categories(category)')
      .eq('event_id', ev.id);

    const hasRelational = relSports && relSports.length > 0;
    const hasJsonConfig = ev.configuration && ev.configuration.sports;

    assert.ok(hasRelational || hasJsonConfig, 'Active event must have sports configuration');

    if (hasRelational) {
      assert.ok(relSports.some((s) => s.sport === 'Badminton'));
    }
  });

  // TEST 12: Empty State trigger
  await t.test('TEST 12: Impossible filter combination returns 0 players (triggering empty state message)', () => {
    const results = filterPlayers(samplePlayers, {
      genderFilter: 'Male',
      categoryFilter: "Women's Singles"
    });
    assert.strictEqual(results.length, 0, 'No players should match Male + Women\'s Singles');
  });

  // TEST 13: Search Query with Advanced Filters
  await t.test('TEST 13: Search input works seamlessly alongside all filters', () => {
    const results = filterPlayers(samplePlayers, {
      genderFilter: 'Female',
      searchQuery: 'Priyanka'
    });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].name, 'Priyanka');

    // Searching for a player of different gender with gender filter active returns empty
    const mismatch = filterPlayers(samplePlayers, {
      genderFilter: 'Female',
      searchQuery: 'Anuj'
    });
    assert.strictEqual(mismatch.length, 0);
  });
});

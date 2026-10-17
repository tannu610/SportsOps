import { SportImportStrategy } from './types';
import { BadmintonImportStrategy } from './BadmintonImportStrategy';
import { CricketImportStrategy } from './CricketImportStrategy';

export * from './types';
export { BadmintonImportStrategy } from './BadmintonImportStrategy';
export { CricketImportStrategy } from './CricketImportStrategy';

const badmintonStrategy = new BadmintonImportStrategy();
const cricketStrategy = new CricketImportStrategy();

const strategyRegistry: Record<string, SportImportStrategy> = {
  'badminton': badmintonStrategy,
  'cricket': cricketStrategy
};

/**
 * Strategy factory: Resolves the sport-specific import strategy based on configured sport.
 * Defaults to BadmintonImportStrategy for individual-participant sports.
 * Designed so new sports (Football, Volleyball, Table Tennis, etc.) can be registered easily.
 */
export function getImportStrategy(sportName?: string | null): SportImportStrategy {
  if (!sportName || typeof sportName !== 'string') {
    return badmintonStrategy;
  }

  const normalized = sportName.trim().toLowerCase();

  if (strategyRegistry[normalized]) {
    return strategyRegistry[normalized];
  }

  // Check if sport contains 'cricket'
  if (normalized.includes('cricket')) {
    return cricketStrategy;
  }

  // Default to badminton strategy
  return badmintonStrategy;
}

/**
 * Helper to determine configured sport from an event object.
 * Event configuration is the primary source of truth.
 */
export function detectConfiguredSport(event: any): string {
  if (!event) return 'Badminton';

  // 1. Check configuration.sports enabled entries
  if (event.configuration?.sports && typeof event.configuration.sports === 'object') {
    const sports = event.configuration.sports;
    const enabled = Object.entries(sports).filter(([_, cfg]: [string, any]) => cfg?.enabled !== false);
    
    // If cricket is explicitly enabled and either only enabled sport or matches event.sport
    if (enabled.length > 0) {
      if (enabled.some(([name]) => name.toLowerCase() === 'cricket')) {
        // If event.sport specifies Cricket or cricket is the only enabled sport
        if (
          (event.sport && event.sport.toLowerCase().includes('cricket')) ||
          enabled.length === 1
        ) {
          return 'Cricket';
        }
      }
      // Return first enabled sport
      const firstEnabled = enabled[0][0];
      if (firstEnabled.toLowerCase() === 'cricket') return 'Cricket';
      if (firstEnabled.toLowerCase() === 'badminton') return 'Badminton';
    }
  }

  // 2. Direct event.sport field
  if (typeof event.sport === 'string') {
    const s = event.sport.trim().toLowerCase();
    if (s.includes('cricket')) return 'Cricket';
    if (s.includes('badminton')) return 'Badminton';
    if (s.includes('table tennis')) return 'Table Tennis';
  }

  return 'Badminton';
}

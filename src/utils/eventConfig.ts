export interface SportConfig {
  enabled: boolean;
  facilityType: string;
  facilityUnit: string;
  facilityCount: number;
  categories: string[];
}

export interface EventConfiguration {
  sports: Record<string, SportConfig>;
}

export const SPORT_FACILITY_DEFAULTS: Record<
  string,
  { facilityType: string; facilityUnit: string; defaultCount: number }
> = {
  "Badminton": { facilityType: "Courts", facilityUnit: "Court", defaultCount: 6 },
  "Table Tennis": { facilityType: "Tables", facilityUnit: "Table", defaultCount: 4 },
  "Cricket": { facilityType: "Grounds", facilityUnit: "Ground", defaultCount: 2 },
  "Football": { facilityType: "Grounds", facilityUnit: "Ground", defaultCount: 2 },
  "Volleyball": { facilityType: "Courts", facilityUnit: "Court", defaultCount: 2 },
  "Other": { facilityType: "Playing Areas", facilityUnit: "Area", defaultCount: 3 }
};

export const DEFAULT_SPORTS_CONFIG: Record<string, SportConfig> = {
  "Badminton": {
    enabled: true,
    facilityType: "Courts",
    facilityUnit: "Court",
    facilityCount: 6,
    categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]
  },
  "Table Tennis": {
    enabled: true,
    facilityType: "Tables",
    facilityUnit: "Table",
    facilityCount: 4,
    categories: ["Men's Singles", "Women's Singles", "Men's Doubles", "Women's Doubles", "Mixed Doubles"]
  },
  "Cricket": {
    enabled: false,
    facilityType: "Grounds",
    facilityUnit: "Ground",
    facilityCount: 2,
    categories: ["Open", "Men's", "Box Cricket"]
  },
  "Football": {
    enabled: false,
    facilityType: "Grounds",
    facilityUnit: "Ground",
    facilityCount: 2,
    categories: ["Open", "Men's 7v7", "Men's 11v11"]
  },
  "Volleyball": {
    enabled: false,
    facilityType: "Courts",
    facilityUnit: "Court",
    facilityCount: 2,
    categories: ["Open", "Men's", "Women's", "Mixed"]
  },
  "Other": {
    enabled: false,
    facilityType: "Playing Areas",
    facilityUnit: "Area",
    facilityCount: 2,
    categories: ["Open", "Singles", "Doubles"]
  }
};

export function validateEventConfigPayload(payload: {
  name?: string;
  eventDate?: string;
  venue?: string;
  configuration?: { sports?: Record<string, SportConfig> };
}): { valid: boolean; error?: string } {
  if (!payload.name || !payload.name.trim()) {
    return { valid: false, error: 'Event Name is required' };
  }
  if (!payload.eventDate || !payload.eventDate.trim()) {
    return { valid: false, error: 'Event Date is required' };
  }
  if (!payload.venue || !payload.venue.trim()) {
    return { valid: false, error: 'Venue is required' };
  }

  const sports = payload.configuration?.sports;
  if (!sports || typeof sports !== 'object' || Object.keys(sports).length === 0) {
    return { valid: false, error: 'At least one sport is required' };
  }

  const enabledSports = Object.entries(sports).filter(([_, cfg]) => cfg.enabled);
  if (enabledSports.length === 0) {
    return { valid: false, error: 'At least one sport must be selected and enabled' };
  }

  for (const [sportName, cfg] of enabledSports) {
    // Validate facility count
    if (!Number.isInteger(cfg.facilityCount) || cfg.facilityCount <= 0) {
      return {
        valid: false,
        error: `Facility count for ${sportName} must be a positive integer (e.g. 1, 2, 4, 6)`
      };
    }

    // Validate facility type
    const expectedFacility = SPORT_FACILITY_DEFAULTS[sportName];
    if (expectedFacility && cfg.facilityType && cfg.facilityType.toLowerCase() !== expectedFacility.facilityType.toLowerCase()) {
      return {
        valid: false,
        error: `Facility type for ${sportName} must match ${expectedFacility.facilityType}`
      };
    }

    // Validate categories
    if (!cfg.categories || !Array.isArray(cfg.categories) || cfg.categories.filter(c => c && c.trim()).length === 0) {
      return {
        valid: false,
        error: `At least one category is required for ${sportName}`
      };
    }
  }

  return { valid: true };
}

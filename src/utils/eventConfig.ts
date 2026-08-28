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

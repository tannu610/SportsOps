export interface ParsedPlayerRecord {
  empId: string;
  name: string;
  sport: string;
  category: string;
  contact?: string | null;
  gender?: string | null;
  email?: string | null;
  teamName?: string | null;
  captainName?: string | null;
  isCaptain?: boolean;
  rawRowNumber?: number;
}

export interface ImportError {
  rowNumber: number;
  reason: string;
  rowData?: Record<string, any>;
}

export interface ImportValidationResult {
  sport: string;
  isTeamBased: boolean;
  totalRows: number;
  validRecords: ParsedPlayerRecord[];
  errors: ImportError[];
  skipped: ImportError[];
  teamsDetected: string[];
  teamPlayerCounts: Record<string, number>;
  teamCaptains?: Record<string, string>;
  teamsCreatedOrUpdated?: number;
  newPlayersCount: number;
  existingPlayersCount: number;
}

export interface SportImportStrategy {
  sportName: string;
  isTeamBased: boolean;
  displayName: string;
  expectedColumnsDescription: string;
  expectedColumns: string[];
  templateFilename: string;
  getTemplateData(): Record<string, any>[];
  parseAndValidate(
    rows: Record<string, any>[],
    existingPlayers: any[],
    eventConfig?: any
  ): ImportValidationResult;
}

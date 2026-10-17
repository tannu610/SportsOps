import {
  SportImportStrategy,
  ImportValidationResult,
  ParsedPlayerRecord,
  ImportError
} from './types';

/**
 * Normalizes a name string for flexible matching across spacing/casing/suffixes.
 */
function normalizeName(name: string): string {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\d+$/, '') // remove trailing numeric suffixes like "Sharma2"
    .replace(/[^a-z0-9]/g, ''); // remove spaces, punctuation
}

/**
 * Normalizes all keys of an input row by removing whitespace, underscores, hyphens, and converting to lowercase.
 * This makes column matching tolerant to formatting variations like 'Team Name ', 'team_name', 'TEAM NAME', etc.
 */
function getNormalizedRow(row: Record<string, any>): Record<string, any> {
  const norm: Record<string, any> = {};
  if (!row || typeof row !== 'object') return norm;
  for (const [k, v] of Object.entries(row)) {
    if (k && v !== undefined && v !== null) {
      const cleanKey = k.trim().toLowerCase().replace(/[\s_\-]+/g, '');
      norm[cleanKey] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return norm;
}

export class CricketImportStrategy implements SportImportStrategy {
  readonly sportName = 'Cricket';
  readonly displayName = 'Cricket Team Roster';
  readonly isTeamBased = true;
  readonly expectedColumns = [
    'Team Name',
    'Captain Name',
    'Player Name',
    'Employee ID',
    'Email',
    'Mobile'
  ];
  readonly expectedColumnsDescription =
    'Team Name, Captain Name, Player Name, Employee ID (optional), Email (optional), Mobile (optional)';
  readonly templateFilename = 'Cricket_Team_Roster_Template.xlsx';

  getTemplateData(): Record<string, any>[] {
    return [
      {
        'Team Name': 'Team Alpha',
        'Captain Name': 'Virat Kohli',
        'Player Name': 'Virat Kohli',
        'Employee ID': 'EMP101',
        'Email': 'virat.k@company.com',
        'Mobile': '9876543210'
      },
      {
        'Team Name': 'Team Alpha',
        'Captain Name': 'Virat Kohli',
        'Player Name': 'Rohit Sharma',
        'Employee ID': 'EMP102',
        'Email': 'rohit.s@company.com',
        'Mobile': '9876543211'
      },
      {
        'Team Name': 'Team Alpha',
        'Captain Name': 'Virat Kohli',
        'Player Name': 'Jasprit Bumrah',
        'Employee ID': 'EMP103',
        'Email': 'jasprit.b@company.com',
        'Mobile': '9876543212'
      },
      {
        'Team Name': 'Team Beta',
        'Captain Name': 'Hardik Pandya',
        'Player Name': 'Hardik Pandya',
        'Employee ID': 'EMP104',
        'Email': 'hardik.p@company.com',
        'Mobile': '9876543213'
      },
      {
        'Team Name': 'Team Beta',
        'Captain Name': 'Hardik Pandya',
        'Player Name': 'KL Rahul',
        'Employee ID': 'EMP105',
        'Email': 'kl.r@company.com',
        'Mobile': '9876543214'
      },
      {
        'Team Name': 'Team Beta',
        'Captain Name': 'Hardik Pandya',
        'Player Name': 'Ravindra Jadeja',
        'Employee ID': 'EMP106',
        'Email': 'ravindra.j@company.com',
        'Mobile': '9876543215'
      }
    ];
  }

  parseAndValidate(
    rows: Record<string, any>[],
    existingPlayers: any[],
    eventConfig?: any
  ): ImportValidationResult {
    const validRecords: ParsedPlayerRecord[] = [];
    const errors: ImportError[] = [];
    const skipped: ImportError[] = [];

    // Track existing players across the system
    const existingEmpMap = new Map<string, any>();
    const existingTeamPlayersMap = new Map<string, any>(); // key: `${teamName.toLowerCase()}_${playerName.toLowerCase()}`

    existingPlayers.forEach((p) => {
      const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
      if (cleanEmp) {
        existingEmpMap.set(cleanEmp, p);
      }
      const team = String(p.team_name || p.push_subscription?._metadata?.team_name || '').trim().toLowerCase();
      const name = String(p.name || '').trim().toLowerCase();
      if (team && name) {
        existingTeamPlayersMap.set(`${team}_${name}`, p);
      }
    });

    // In-batch tracking
    const batchSeenEmpIds = new Map<string, { teamName: string; rowNum: number }>();
    const batchSeenTeamPlayers = new Map<string, { rowNum: number }>();
    const teamToDeclaredCaptain = new Map<string, { captainName: string; rowNum: number; originalTeamName: string }>();
    const teamRostersMap = new Map<string, Array<{ name: string; rowNum: number; empId: string }>>();
    const teamsSet = new Set<string>();
    const teamPlayerCounts: Record<string, number> = {};

    let newPlayersCount = 0;
    let existingPlayersCount = 0;

    // Determine category from event configuration if available (e.g. 'Open Cricket' or 'Box Cricket')
    let defaultCategory = 'Open Cricket';
    if (eventConfig?.sports?.Cricket?.categories?.[0]) {
      defaultCategory = eventConfig.sports.Cricket.categories[0];
    }

    rows.forEach((row, index) => {
      const rowNum = index + 2; // 1-indexed (row 1 is header)
      const normRow = getNormalizedRow(row);

      // Column name variations with header tolerance (spaces, underscores, casing):
      // Accepts 'Team Name', 'team_name', 'Team Name ', 'Team', 'teamName', etc.
      const rawTeamName = String(
        normRow['teamname'] ||
        normRow['team'] ||
        row['teamName'] ||
        row['Team Name'] ||
        row['Team'] ||
        row['TeamName'] ||
        row['team_name'] ||
        row['team'] ||
        ''
      ).trim();

      const rawPlayerName = String(
        normRow['playername'] ||
        normRow['name'] ||
        normRow['player'] ||
        row['playerName'] ||
        row['Player Name'] ||
        row['Name'] ||
        row['player_name'] ||
        row['name'] ||
        ''
      ).trim();

      // Accepts 'Captain Name', 'Team Captain Name', 'Team Captain', 'Captain', 'captainName', etc.
      const rawCaptainName = String(
        normRow['captainname'] ||
        normRow['teamcaptainname'] ||
        normRow['teamcaptain'] ||
        normRow['captain'] ||
        row['captainName'] ||
        row['Captain Name'] ||
        row['Team Captain Name'] ||
        row['Team Captain'] ||
        row['Captain'] ||
        row['captain_name'] ||
        row['captain'] ||
        ''
      ).trim();

      const rawEmpId = String(
        normRow['employeeid'] ||
        normRow['empid'] ||
        normRow['employee'] ||
        row['empId'] ||
        row['Employee ID'] ||
        row['Employee Id'] ||
        row['employee_id'] ||
        row['Emp ID'] ||
        row['EmpId'] ||
        row['EmployeeID'] ||
        ''
      ).trim();

      const rawEmail = String(
        normRow['email'] ||
        normRow['emailid'] ||
        normRow['emailaddress'] ||
        row['email'] ||
        row['Email'] ||
        row['Email ID'] ||
        row['Email Address'] ||
        ''
      ).trim();

      const rawMobile = String(
        normRow['mobile'] ||
        normRow['mobileno'] ||
        normRow['mobilenumber'] ||
        normRow['contact'] ||
        normRow['contactno'] ||
        normRow['phone'] ||
        normRow['phoneno'] ||
        row['contact'] ||
        row['mobile'] ||
        row['Mobile'] ||
        row['Contact'] ||
        row['Phone'] ||
        ''
      ).trim();

      const rawCategory = String(
        normRow['category'] ||
        normRow['categoryname'] ||
        row['category'] ||
        row['Category'] ||
        defaultCategory
      ).trim();

      // Check for completely empty row
      if (!rawTeamName && !rawPlayerName && !rawCaptainName && !rawEmpId) {
        skipped.push({ rowNumber: rowNum, reason: 'Empty row' });
        return;
      }

      // 1. Validate Team Name
      if (!rawTeamName) {
        errors.push({
          rowNumber: rowNum,
          reason: `Missing Team Name for player: ${rawPlayerName || 'Unknown'} (EMP: ${rawEmpId || 'N/A'})`,
          rowData: row
        });
        return;
      }

      // 2. Validate Player Name
      if (!rawPlayerName) {
        errors.push({
          rowNumber: rowNum,
          reason: `Missing Player Name for Team: "${rawTeamName}"`,
          rowData: row
        });
        return;
      }

      // 3. Validate Captain Name
      if (!rawCaptainName) {
        errors.push({
          rowNumber: rowNum,
          reason: `Missing Captain Name for Team: "${rawTeamName}" (Player: "${rawPlayerName}"). Every player in the team must reference the declared Captain Name.`,
          rowData: row
        });
        return;
      }

      // Ensure Captain Name is an actual player name, not Yes/No or boolean
      const lowerCap = rawCaptainName.toLowerCase();
      if (['yes', 'no', 'y', 'n', 'true', 'false'].includes(lowerCap)) {
        errors.push({
          rowNumber: rowNum,
          reason: `Captain Name for Team "${rawTeamName}" must contain the captain's actual player name, not "${rawCaptainName}".`,
          rowData: row
        });
        return;
      }

      // 4. Validate Captain Consistency within Team
      const teamKey = rawTeamName.toLowerCase();
      if (!teamToDeclaredCaptain.has(teamKey)) {
        teamToDeclaredCaptain.set(teamKey, {
          captainName: rawCaptainName,
          rowNum,
          originalTeamName: rawTeamName
        });
      } else {
        const prev = teamToDeclaredCaptain.get(teamKey)!;
        if (normalizeName(prev.captainName) !== normalizeName(rawCaptainName)) {
          errors.push({
            rowNumber: rowNum,
            reason: `Inconsistent Captain for Team "${rawTeamName}": previously declared as "${prev.captainName}" on Row ${prev.rowNum}, but Row ${rowNum} specifies "${rawCaptainName}". Every player in the team must reference the same Captain Name.`,
            rowData: row
          });
          return;
        }
      }

      let cleanEmpUpper: string;
      const teamPlayerKey = `${teamKey}_${rawPlayerName.toLowerCase()}`;

      // 5. Handle Employee ID and Duplicates
      if (rawEmpId) {
        cleanEmpUpper = rawEmpId.toUpperCase();

        if (batchSeenEmpIds.has(cleanEmpUpper)) {
          const prev = batchSeenEmpIds.get(cleanEmpUpper)!;
          if (prev.teamName.toLowerCase() === teamKey) {
            errors.push({
              rowNumber: rowNum,
              reason: `Duplicate Player (EMP ID: ${cleanEmpUpper}) listed multiple times in Team "${rawTeamName}" (First seen on Row ${prev.rowNum})`,
              rowData: row
            });
          } else {
            errors.push({
              rowNumber: rowNum,
              reason: `Conflict: Player "${rawPlayerName}" (EMP ID: ${cleanEmpUpper}) is assigned to multiple teams: "${prev.teamName}" (Row ${prev.rowNum}) and "${rawTeamName}" (Row ${rowNum}). A player cannot belong to multiple cricket teams in the same event.`,
              rowData: row
            });
          }
          return;
        }
        batchSeenEmpIds.set(cleanEmpUpper, { teamName: rawTeamName, rowNum });
      } else {
        // Employee ID is optional in Cricket team roster
        // Check for duplicate player within the same team
        if (batchSeenTeamPlayers.has(teamPlayerKey)) {
          const prev = batchSeenTeamPlayers.get(teamPlayerKey)!;
          errors.push({
            rowNumber: rowNum,
            reason: `Duplicate Player "${rawPlayerName}" listed multiple times in Team "${rawTeamName}" (First seen on Row ${prev.rowNum})`,
            rowData: row
          });
          return;
        }

        // Check if player already exists in database for this team to preserve employee_id
        const existingMatch = existingTeamPlayersMap.get(teamPlayerKey);
        if (existingMatch && existingMatch.employee_id) {
          cleanEmpUpper = String(existingMatch.employee_id).trim().toUpperCase();
        } else {
          // Generate deterministic internal Employee ID to satisfy DB not-null constraint
          const slugTeam = rawTeamName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const slugPlayer = rawPlayerName.toLowerCase().replace(/[^a-z0-9]/g, '');
          cleanEmpUpper = `CRK-${slugTeam}-${slugPlayer}`.toUpperCase();
        }
      }

      batchSeenTeamPlayers.set(teamPlayerKey, { rowNum });

      // Track player in team roster for post-loop captain existence validation
      if (!teamRostersMap.has(teamKey)) {
        teamRostersMap.set(teamKey, []);
      }
      teamRostersMap.get(teamKey)!.push({
        name: rawPlayerName,
        rowNum,
        empId: cleanEmpUpper
      });

      // Check if player exists in system (for count)
      const existsInDb = existingEmpMap.has(cleanEmpUpper) || existingTeamPlayersMap.has(teamPlayerKey);
      if (existsInDb) {
        existingPlayersCount++;
      } else {
        newPlayersCount++;
      }

      // Track team detection
      teamsSet.add(rawTeamName);
      teamPlayerCounts[rawTeamName] = (teamPlayerCounts[rawTeamName] || 0) + 1;

      validRecords.push({
        empId: cleanEmpUpper,
        name: rawPlayerName,
        sport: this.sportName,
        category: rawCategory || defaultCategory,
        teamName: rawTeamName,
        captainName: rawCaptainName,
        email: rawEmail || null,
        contact: rawMobile || null,
        rawRowNumber: rowNum,
        // Canonical aliases for Excel header representations
        'Team Name': rawTeamName,
        'Captain Name': rawCaptainName,
        'Player Name': rawPlayerName,
        'playerName': rawPlayerName,
        'Employee ID': cleanEmpUpper
      });
    });

    // 6. Validate that declared captain exists as a player in that team
    teamToDeclaredCaptain.forEach((info, teamKey) => {
      const roster = teamRostersMap.get(teamKey) || [];
      const normCaptain = normalizeName(info.captainName);
      const captainPlayer = roster.find((p) => normalizeName(p.name) === normCaptain);

      if (!captainPlayer) {
        errors.push({
          rowNumber: info.rowNum,
          reason: `Declared Captain "${info.captainName}" does not exist in the player roster for Team "${info.originalTeamName}". The captain must be a registered player in that team.`
        });
      }
    });

    // 7. Update isCaptain flag on validRecords
    validRecords.forEach((r) => {
      const teamKey = (r.teamName || '').toLowerCase();
      const capInfo = teamToDeclaredCaptain.get(teamKey);
      if (capInfo) {
        r.captainName = capInfo.captainName;
        r['Captain Name'] = capInfo.captainName;
        r.isCaptain = normalizeName(r.name) === normalizeName(capInfo.captainName);
      }
    });

    const teamsDetected = Array.from(teamsSet);
    const teamCaptains: Record<string, string> = {};
    teamToDeclaredCaptain.forEach((val) => {
      teamCaptains[val.originalTeamName] = val.captainName;
    });

    return {
      sport: this.sportName,
      isTeamBased: true,
      totalRows: rows.length,
      validRecords,
      errors,
      skipped,
      teamsDetected,
      teamPlayerCounts,
      teamCaptains,
      teamsCreatedOrUpdated: teamsDetected.length,
      newPlayersCount,
      existingPlayersCount
    };
  }
}

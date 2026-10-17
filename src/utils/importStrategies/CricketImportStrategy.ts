import {
  SportImportStrategy,
  ImportValidationResult,
  ParsedPlayerRecord,
  ImportError
} from './types';
import { extractPlayerCode } from '../playerCode';

export class CricketImportStrategy implements SportImportStrategy {
  readonly sportName = 'Cricket';
  readonly displayName = 'Cricket Team Roster';
  readonly isTeamBased = true;
  readonly expectedColumns = [
    'Team Name',
    'Player Name',
    'Employee ID',
    'Email',
    'Mobile'
  ];
  readonly expectedColumnsDescription =
    'Team Name, Player Name, Employee ID, Email (optional), Mobile (optional)';
  readonly templateFilename = 'Cricket_Team_Roster_Template.xlsx';

  getTemplateData(): Record<string, any>[] {
    return [
      {
        'Team Name': 'Team Alpha',
        'Player Name': 'Virat Kohli',
        'Employee ID': 'EMP101',
        'Email': 'virat.k@company.com',
        'Mobile': '9876543210'
      },
      {
        'Team Name': 'Team Alpha',
        'Player Name': 'Rohit Sharma',
        'Employee ID': 'EMP102',
        'Email': 'rohit.s@company.com',
        'Mobile': '9876543211'
      },
      {
        'Team Name': 'Team Alpha',
        'Player Name': 'Jasprit Bumrah',
        'Employee ID': 'EMP103',
        'Email': 'jasprit.b@company.com',
        'Mobile': '9876543212'
      },
      {
        'Team Name': 'Team Beta',
        'Player Name': 'Hardik Pandya',
        'Employee ID': 'EMP104',
        'Email': 'hardik.p@company.com',
        'Mobile': '9876543213'
      },
      {
        'Team Name': 'Team Beta',
        'Player Name': 'KL Rahul',
        'Employee ID': 'EMP105',
        'Email': 'kl.r@company.com',
        'Mobile': '9876543214'
      },
      {
        'Team Name': 'Team Beta',
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

    // Track existing employee IDs across the system
    const existingEmpMap = new Map<string, any>();
    existingPlayers.forEach((p) => {
      const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
      if (cleanEmp) {
        existingEmpMap.set(cleanEmp, p);
      }
    });

    // In-batch duplicate tracking
    const batchSeenEmpIds = new Map<string, { teamName: string; rowNum: number }>();
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

      // Column name variations
      const rawTeamName = String(
        row['Team Name'] ||
        row['Team'] ||
        row['TeamName'] ||
        row['team_name'] ||
        row['team'] ||
        ''
      ).trim();

      const rawPlayerName = String(
        row['Player Name'] ||
        row['Name'] ||
        row['player_name'] ||
        row['name'] ||
        ''
      ).trim();

      const rawEmpId = String(
        row['Employee ID'] ||
        row['Employee Id'] ||
        row['employee_id'] ||
        row['Emp ID'] ||
        row['EmpId'] ||
        row['EmployeeID'] ||
        ''
      ).trim();

      const rawEmail = String(
        row['Email'] ||
        row['Email ID'] ||
        row['Email Address'] ||
        row['email'] ||
        ''
      ).trim();

      const rawMobile = String(
        row['Mobile'] ||
        row['Mobile No'] ||
        row['Phone'] ||
        row['Contact'] ||
        row['contact'] ||
        row['mobile'] ||
        ''
      ).trim();

      const rawCategory = String(
        row['Category'] ||
        row['category'] ||
        defaultCategory
      ).trim();

      // Check for completely empty row
      if (!rawTeamName && !rawPlayerName && !rawEmpId) {
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
          reason: `Missing Player Name for Team: "${rawTeamName}" (EMP: ${rawEmpId || 'N/A'})`,
          rowData: row
        });
        return;
      }

      // 3. Validate Employee ID
      if (!rawEmpId) {
        errors.push({
          rowNumber: rowNum,
          reason: `Missing Employee ID for player "${rawPlayerName}" in Team: "${rawTeamName}"`,
          rowData: row
        });
        return;
      }

      const cleanEmpUpper = rawEmpId.toUpperCase();

      // 4. Duplicate checks in uploaded file
      if (batchSeenEmpIds.has(cleanEmpUpper)) {
        const prev = batchSeenEmpIds.get(cleanEmpUpper)!;
        if (prev.teamName.toLowerCase() === rawTeamName.toLowerCase()) {
          errors.push({
            rowNumber: rowNum,
            reason: `Duplicate Player (EMP ID: ${cleanEmpUpper}) listed multiple times in Team "${rawTeamName}" (First seen on Row ${prev.rowNum})`,
            rowData: row
          });
        } else {
          errors.push({
            rowNumber: rowNum,
            reason: `Conflict: Player (EMP ID: ${cleanEmpUpper}) assigned to multiple teams: "${prev.teamName}" (Row ${prev.rowNum}) and "${rawTeamName}" (Row ${rowNum})`,
            rowData: row
          });
        }
        return;
      }
      batchSeenEmpIds.set(cleanEmpUpper, { teamName: rawTeamName, rowNum });

      // Check if player exists in system
      if (existingEmpMap.has(cleanEmpUpper)) {
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
        email: rawEmail || null,
        contact: rawMobile || null,
        rawRowNumber: rowNum
      });
    });

    const teamsDetected = Array.from(teamsSet);

    return {
      sport: this.sportName,
      isTeamBased: true,
      totalRows: rows.length,
      validRecords,
      errors,
      skipped,
      teamsDetected,
      teamPlayerCounts,
      newPlayersCount,
      existingPlayersCount
    };
  }
}

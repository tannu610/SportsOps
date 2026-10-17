import {
  SportImportStrategy,
  ImportValidationResult,
  ParsedPlayerRecord,
  ImportError
} from './types';
import { extractPlayerCode } from '../playerCode';

/**
 * Normalizes all keys of an input row by removing whitespace, underscores, hyphens, and converting to lowercase.
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

export class BadmintonImportStrategy implements SportImportStrategy {
  readonly sportName = 'Badminton';
  readonly displayName = 'Badminton Player List';
  readonly isTeamBased = false;
  readonly expectedColumns = [
    'Employee ID',
    'Name',
    'Sport',
    'Category',
    'Mobile',
    'Gender'
  ];
  readonly expectedColumnsDescription =
    'Employee ID, Name, Sport, Category (optional), Mobile (optional), Gender (optional)';
  readonly templateFilename = 'Badminton_Player_List_Template.xlsx';

  getTemplateData(): Record<string, any>[] {
    return [
      {
        'Employee ID': 'EMP001',
        'Name': 'Rohit Sharma',
        'Sport': 'Badminton',
        'Category': "Men's Singles",
        'Mobile': '9876543210',
        'Gender': 'Male'
      },
      {
        'Employee ID': 'EMP002',
        'Name': 'PV Sindhu',
        'Sport': 'Badminton',
        'Category': "Women's Singles",
        'Mobile': '9876543211',
        'Gender': 'Female'
      },
      {
        'Employee ID': 'EMP003',
        'Name': 'Lakshya Sen',
        'Sport': 'Badminton',
        'Category': "Men's Singles",
        'Mobile': '9876543212',
        'Gender': 'Male'
      },
      {
        'Employee ID': 'EMP004',
        'Name': 'Ashwini Ponnappa',
        'Sport': 'Badminton',
        'Category': "Women's Doubles",
        'Mobile': '9876543213',
        'Gender': 'Female'
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

    // Map existing employees
    const existingEmpIds = new Set<string>();
    const existingPlayerTriplets = new Set<string>(); // empId + sport + category

    existingPlayers.forEach((p) => {
      const cleanEmp = String(p.employee_id || '').trim().toUpperCase();
      if (cleanEmp) existingEmpIds.add(cleanEmp);
      const trip = `${cleanEmp}_${String(p.sport || '').trim().toLowerCase()}_${String(p.category || 'NA').trim().toLowerCase()}`;
      existingPlayerTriplets.add(trip);
    });

    // In-batch duplicate tracking
    const batchSeenTriplets = new Set<string>();
    let existingCount = 0;
    let newCount = 0;

    rows.forEach((row, index) => {
      const rowNum = index + 2; // 1-indexed, header is row 1
      const normRow = getNormalizedRow(row);

      const empId = String(
        normRow['employeeid'] ||
        normRow['empid'] ||
        normRow['employee'] ||
        row['Employee ID'] ||
        row['Employee Id'] ||
        row['employee_id'] ||
        row['Emp ID'] ||
        row['EmpId'] ||
        row['EmployeeID'] ||
        row['empId'] ||
        ''
      ).trim();

      const name = String(
        normRow['playername'] ||
        normRow['name'] ||
        normRow['player'] ||
        row['Name'] ||
        row['Player Name'] ||
        row['name'] ||
        row['PlayerName'] ||
        row['playerName'] ||
        ''
      ).trim();

      const sport = String(
        normRow['sport'] ||
        row['Sport'] ||
        row['sport'] ||
        'Badminton'
      ).trim();

      const category = String(
        normRow['category'] ||
        normRow['categoryname'] ||
        row['Category'] ||
        row['category'] ||
        'NA'
      ).trim();

      const contact = String(
        normRow['contact'] ||
        normRow['mobile'] ||
        normRow['phone'] ||
        row['Contact'] ||
        row['Mobile'] ||
        row['Phone'] ||
        row['mobile'] ||
        row['contact'] ||
        ''
      ).trim();

      const gender = String(
        normRow['gender'] ||
        row['Gender'] ||
        row['gender'] ||
        ''
      ).trim();

      // Validations
      if (!empId && !name) {
        skipped.push({ rowNumber: rowNum, reason: 'Empty row' });
        return;
      }

      if (!empId) {
        errors.push({ rowNumber: rowNum, reason: 'Missing Employee ID', rowData: row });
        return;
      }

      if (!name) {
        errors.push({ rowNumber: rowNum, reason: `Missing Player Name for EMP ID: ${empId}`, rowData: row });
        return;
      }

      const cleanEmpUpper = empId.toUpperCase();
      const tripKey = `${cleanEmpUpper}_${sport.toLowerCase()}_${category.toLowerCase()}`;

      // Check duplicates in uploaded batch
      if (batchSeenTriplets.has(tripKey)) {
        errors.push({
          rowNumber: rowNum,
          reason: `Duplicate entry for ${empId} in ${sport} (${category}) in uploaded file`,
          rowData: row
        });
        return;
      }
      batchSeenTriplets.add(tripKey);

      // Check if already registered in database for this sport/category
      if (existingPlayerTriplets.has(tripKey)) {
        skipped.push({
          rowNumber: rowNum,
          reason: `Player ${empId} already registered for ${sport} (${category}) in this event`,
          rowData: row
        });
        return;
      }

      if (existingEmpIds.has(cleanEmpUpper)) {
        existingCount++;
      } else {
        newCount++;
        existingEmpIds.add(cleanEmpUpper);
      }

      validRecords.push({
        empId: cleanEmpUpper,
        name,
        sport,
        category: category || 'NA',
        contact: contact || null,
        gender: gender || null,
        rawRowNumber: rowNum,
        // Canonical aliases for both camelCase and Excel header representations
        'Employee ID': cleanEmpUpper,
        'Player Name': name,
        'playerName': name,
        'Sport': sport,
        'Category': category || 'NA',
        'Mobile': contact || null,
        'Gender': gender || null
      });
    });

    return {
      sport: this.sportName,
      isTeamBased: false,
      totalRows: rows.length,
      validRecords,
      errors,
      skipped,
      teamsDetected: [],
      teamPlayerCounts: {},
      newPlayersCount: newCount,
      existingPlayersCount: existingCount
    };
  }
}

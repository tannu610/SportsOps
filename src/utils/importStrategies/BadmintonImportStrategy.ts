import {
  SportImportStrategy,
  ImportValidationResult,
  ParsedPlayerRecord,
  ImportError
} from './types';
import { extractPlayerCode } from '../playerCode';

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

      const empId = String(
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
        row['Name'] ||
        row['Player Name'] ||
        row['name'] ||
        row['PlayerName'] ||
        row['playerName'] ||
        ''
      ).trim();

      const sport = String(
        row['Sport'] ||
        row['sport'] ||
        'Badminton'
      ).trim();

      const category = String(
        row['Category'] ||
        row['category'] ||
        'NA'
      ).trim();

      const contact = String(
        row['Contact'] ||
        row['Mobile'] ||
        row['Phone'] ||
        row['mobile'] ||
        row['contact'] ||
        ''
      ).trim();

      const gender = String(
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
        rawRowNumber: rowNum
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

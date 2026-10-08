import * as XLSX from 'xlsx';

export interface MatchHistoryExportRecord {
  match_code: string;
  sport: string;
  category: string;
  phase: string;
  playing_area: string;
  team1_names: string;
  team2_names: string;
  referee_name: string;
  winner_name: string;
  score_notes: string | null;
  scheduled_time: string;
  completed_at: string;
}

export const MATCH_HISTORY_EXCEL_COLUMNS = [
  'Match Code',
  'Sport',
  'Category',
  'Round',
  'Play Area / Court',
  'Player 1 / Team 1',
  'Player 2 / Team 2',
  'Referee',
  'Winner',
  'Result / Score',
  'Match Time',
  'Completed At',
] as const;

/**
 * Formats a scheduled ISO time string into readable 12-hour time (e.g. "9:12 PM").
 */
export function formatMatchTimeForExport(isoString?: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

/**
 * Formats a completed ISO timestamp into readable time and date (e.g. "9:35 PM, Oct 9, 2026").
 */
export function formatCompletedAtForExport(isoString?: string | null): string {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const timeStr = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${timeStr}, ${dateStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Generates a clean, dynamic filename based on filter context and date.
 * Example: "SportsOps_Match_History_2026-10-09.xlsx"
 * Example with sport: "SportsOps_Match_History_Badminton_2026-10-09.xlsx"
 */
export function generateMatchHistoryFilename(
  filters?: {
    sport?: string;
    category?: string;
    round?: string;
    referee?: string;
  },
  now = new Date()
): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const parts: string[] = ['SportsOps', 'Match_History'];

  if (filters?.sport && filters.sport !== 'ALL') {
    const cleanSport = filters.sport.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    if (cleanSport) parts.push(cleanSport);
  }

  if (filters?.category && filters.category !== 'ALL') {
    const cleanCat = filters.category.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    if (cleanCat) parts.push(cleanCat);
  }

  parts.push(dateStr);
  return `${parts.join('_')}.xlsx`;
}

/**
 * Converts a Match History item to a row matching MATCH_HISTORY_EXCEL_COLUMNS.
 */
export function formatMatchHistoryRow(item: MatchHistoryExportRecord): string[] {
  return [
    String(item.match_code || ''),
    String(item.sport || ''),
    String(item.category || ''),
    String(item.phase || ''),
    String(item.playing_area || ''),
    String(item.team1_names || 'Team 1'),
    String(item.team2_names || 'Team 2'),
    String(item.referee_name || ''),
    String(item.winner_name || ''),
    String(item.score_notes || '-'),
    formatMatchTimeForExport(item.scheduled_time),
    formatCompletedAtForExport(item.completed_at),
  ];
}

/**
 * Builds an XLSX workbook object from match history records.
 * Ensures:
 * 1. Single sheet named "Match History"
 * 2. Proper header row
 * 3. Text cell types (t: 's') so results like "21-18" are preserved as text and never misparsed as dates/formulas
 * 4. Frozen header row
 * 5. Auto-sized column widths with sensible minimums
 */
export function buildMatchHistoryWorkbook(
  items: MatchHistoryExportRecord[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const rows: string[][] = [
    [...MATCH_HISTORY_EXCEL_COLUMNS],
    ...items.map(formatMatchHistoryRow),
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Freeze top row (Header row)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!views'] = [
    {
      state: 'frozen',
      ySplit: 1,
      topLeftCell: 'A2',
      activePane: 'bottomLeft',
    },
  ];

  // Base minimum widths for each column
  const minWidths = [14, 14, 18, 14, 18, 22, 22, 16, 20, 16, 14, 24];

  // Calculate dynamic column widths based on contents
  const colWidths = MATCH_HISTORY_EXCEL_COLUMNS.map((colName, colIdx) => {
    let maxLen = colName.length;
    for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
      const cellVal = rows[rowIdx][colIdx] || '';
      if (cellVal.length > maxLen) {
        maxLen = cellVal.length;
      }
    }
    const minW = minWidths[colIdx] || 15;
    return { wch: Math.max(minW, maxLen + 3) };
  });

  ws['!cols'] = colWidths;

  // Force all cells to text format ('s') to preserve codes, scores, and timestamps
  Object.keys(ws).forEach((cellKey) => {
    if (cellKey.startsWith('!')) return;
    const cell = ws[cellKey];
    if (cell && cell.v !== undefined) {
      cell.t = 's';
      cell.v = String(cell.v);
    }
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Match History');

  return wb;
}

/**
 * Builds an Excel buffer from match history records.
 * Usable in server API routes and Node.js testing environments.
 */
export function buildMatchHistoryExcelBuffer(
  items: MatchHistoryExportRecord[]
): Buffer {
  const wb = buildMatchHistoryWorkbook(items);
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

/**
 * Triggers an automatic Excel (.xlsx) file download in the browser.
 */
export function downloadMatchHistoryExcel(
  items: MatchHistoryExportRecord[],
  filename: string
): void {
  if (typeof window === 'undefined') {
    throw new Error('downloadMatchHistoryExcel can only be called in a browser environment.');
  }

  const wb = buildMatchHistoryWorkbook(items);
  const excelArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

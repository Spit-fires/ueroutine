import workbookJson from '#lib/data/workbook.json';
import {
	emptyCell,
	sortRoster,
	toISODate,
	type Cell,
	type ClassRow,
	type Day,
	type Workspace,
	WORKSPACE_VERSION,
	type Entry
} from './types';

/* -------------------------------------------------------------- workbook -- */

export interface WorkbookCell {
	s: string;
	t: string;
	black: boolean;
}

export interface WorkbookRow {
	grade: string;
	section: string;
	cells: (WorkbookCell | null)[];
}

export interface WorkbookDay {
	sheet: string;
	date: string;
	rows: WorkbookRow[];
}

export interface Workbook {
	source: string;
	times: string[];
	classes: { grade: string; section: string }[];
	subjects: string[];
	teachers: string[];
	days: WorkbookDay[];
}

export const workbook = workbookJson as unknown as Workbook;

/* ------------------------------------------------------------------ time -- */

/** Turn "9:00 AM" into minutes since midnight (null when unparseable). */
export function timeToMinutes(label: string): number | null {
	const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
	if (!m) return null;
	let hour = Number(m[1]);
	const minute = Number(m[2]);
	const suffix = m[3]?.toUpperCase();
	if (suffix === 'PM' && hour !== 12) hour += 12;
	if (suffix === 'AM' && hour === 12) hour = 0;
	return hour * 60 + minute;
}

export function minutesToTime(minutes: number): string {
	const wrapped = ((minutes % 1440) + 1440) % 1440;
	const hour24 = Math.floor(wrapped / 60);
	const minute = wrapped % 60;
	const suffix = hour24 < 12 ? 'AM' : 'PM';
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return `${hour12}:${`${minute}`.padStart(2, '0')} ${suffix}`;
}

/** Build evenly spaced period labels. */
export function buildPeriods(count: number, start = '9:00 AM', stepMinutes = 30): string[] {
	const startMinutes = timeToMinutes(start) ?? 9 * 60;
	return Array.from({ length: count }, (_, i) => minutesToTime(startMinutes + i * stepMinutes));
}

/**
 * How many leading periods stay in the first colour group: every period whose
 * label parses to a time before `shiftTime` (e.g. "12:00 PM"). Labels that do
 * not parse (custom text) never trigger the shift.
 */
export function splitForTime(periods: string[], shiftTime: string): number {
	const threshold = timeToMinutes(shiftTime);
	if (threshold === null) return Math.max(1, Math.ceil(periods.length / 2));
	const index = periods.findIndex((label) => {
		const minutes = timeToMinutes(label);
		return minutes !== null && minutes >= threshold;
	});
	const split = index === -1 ? periods.length : index;
	return Math.max(1, Math.min(split, periods.length));
}

/* ------------------------------------------------------------------ seed -- */

/**
 * Names containing "/" are the workbook's workaround for alternatives and
 * co-taught pairs; the desk represents those properly, so they stay out of
 * the seed lists. Anything else can be typed freely in a cell.
 */
const withoutSlash = (list: string[]): string[] => list.filter((name) => !name.includes('/'));

/** The six main classes; `school` is a filter tag, not a real header column. */
export const DEFAULT_CLASSES: ClassRow[] = ['3', '6', '7', '8', '9', '10'].map((grade, i) => ({
	id: `c${i + 1}`,
	grade,
	section: '',
	school: 'All'
}));

export function defaultDays(today: string): Day[] {
	return [{ id: 'd1', date: today, grid: emptyGrid(DEFAULT_CLASSES) }];
}

export function emptyGrid(classes: ClassRow[], periods = 14): Record<string, Cell[]> {
	const grid: Record<string, Cell[]> = {};
	for (const row of classes) grid[row.id] = Array.from({ length: periods }, emptyCell);
	return grid;
}

export function createInitialWorkspace(today = toISODate(new Date())): Workspace {
	const periods = buildPeriods(14, '9:00 AM', 30);
	const shiftTime = '12:00 PM';
	return {
		version: WORKSPACE_VERSION,
		school: 'Utsaho Educare',
		periods,
		groupSplit: splitForTime(periods, shiftTime),
		shiftTime,
		groupNames: ['Morning', 'Afternoon'],
		classes: DEFAULT_CLASSES,
		days: defaultDays(today),
		subjects: sortRoster(withoutSlash(workbook.subjects)),
		teachers: sortRoster(withoutSlash(workbook.teachers)),
		// A moduleSize of 0 means "tune the data band automatically".
		band: { moduleSize: 0, embedText: true, scale: 2 }
	};
}

/* ------------------------------------------------- workbook → workspace -- */

/** Convert one workbook day into a Day that fits a workspace column count. */
export function workbookDayToDay(
	entry: WorkbookDay,
	classes: ClassRow[],
	periods: number,
	id: string
): { day: Day; placed: number; dropped: number } {
	const grid: Record<string, Cell[]> = {};
	let placed = 0;
	let dropped = 0;

	for (let r = 0; r < entry.rows.length; r++) {
		const wbRow = entry.rows[r];
		// Workbook sections ("Boys", "Ssac") are legacy; rows join by grade.
		const target = classes.find((c) => c.grade === wbRow.grade) ?? classes[r];
		if (!target) continue;
		const cells: Cell[] = grid[target.id] ?? Array.from({ length: periods }, emptyCell);
		for (let p = 0; p < wbRow.cells.length; p++) {
			const source = wbRow.cells[p];
			if (!source) continue;
			if (p >= periods) {
				dropped++;
				continue;
			}
			if (!cells[p]) cells[p] = emptyCell();
			const entries: Entry[] = [];
			if (source.s || source.t) entries.push({ subject: source.s, teacher: source.t });
			cells[p] = { entries, mark: source.black ? 'black' : 'none' };
			placed++;
		}
		grid[target.id] = cells;
	}

	// Every class row must exist so the grid stays rectangular.
	for (const row of classes) grid[row.id] ??= Array.from({ length: periods }, emptyCell);

	return { day: { id, date: entry.date, grid }, placed, dropped };
}

/** Days from the source workbook, ordered by date. */
export function workbookDaysSorted(): WorkbookDay[] {
	return [...workbook.days].sort((a, b) => (a.date < b.date ? -1 : 1));
}

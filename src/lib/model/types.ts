/**
 * Domain model for the routine desk.
 *
 * A routine is a grid: one row per class, one column per period of the day.
 * Every intersection is a `Cell` holding up to two entries. One entry renders
 * as the classic "subject over teacher" stack; two entries split the cell into
 * four quadrants (subject | subject on top, teacher | teacher underneath).
 * A cell can also be marked — blacked out (the school's mark for a slot that
 * lives inside a code, painted black with white text) or highlighted yellow or
 * red. The workbook paints those fills and the app reproduces exactly that.
 */

export const WORKSPACE_VERSION = 1;

/** One subject/teacher pair. Either side may be empty. */
export interface Entry {
	subject: string;
	teacher: string;
}

/** How a cell is painted: plain, blacked out, yellow or red highlighted. */
export type CellMark = 'none' | 'black' | 'yellow' | 'red';

/** A grid intersection: how many entries, and how the cell is marked. */
export interface Cell {
	entries: Entry[];
	mark: CellMark;
}

/**
 * A class row, e.g. grade "9". `school` is a free tag shown next to the grade
 * ("All" means untagged); `section` is legacy workbook data, always empty.
 */
export interface ClassRow {
	id: string;
	grade: string;
	section: string;
	school: string;
}

/** One dated routine. `grid` is keyed by class-row id, then by period index. */
export interface Day {
	id: string;
	date: string;
	grid: Record<string, Cell[]>;
}

/** Export settings for the PNG payload and its data band. */
export interface BandOptions {
	/** Band module size in layout pixels. `0` tunes it automatically. */
	moduleSize: number;
	/** Also embed the payload losslessly in a PNG tEXt chunk. */
	embedText: boolean;
	/** Text crispness multiplier for the whole document. */
	scale: number;
}

export interface Workspace {
	version: number;
	school: string;
	/** Period labels, e.g. "9:00 AM". Length defines the column count. */
	periods: string[];
	/** How many leading periods belong to the first colour group. */
	groupSplit: number;
	/** Period time where the second colour group starts, e.g. "12:00 PM". */
	shiftTime: string;
	/** Optional names for the two colour groups. */
	groupNames: [string, string];
	classes: ClassRow[];
	days: Day[];
	subjects: string[];
	teachers: string[];
	band: BandOptions;
}

export interface Selection {
	dayId: string;
	classId: string;
	period: number;
}

export function emptyCell(): Cell {
	return { entries: [], mark: 'none' };
}

export function entryOf(subject = '', teacher = ''): Entry {
	return { subject, teacher };
}

export function cellIsEmpty(cell: Cell | undefined): boolean {
	if (!cell) return true;
	if (cell.mark !== 'none') return false;
	return cell.entries.every((e) => !e.subject.trim() && !e.teacher.trim());
}

export function className(row: ClassRow): string {
	return [row.grade, row.section].filter(Boolean).join(' ');
}

/** Roster order, case-insensitive — subjects and teachers are always sorted. */
export function sortRoster(list: string[]): string[] {
	return [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function parseDate(date: string): Date {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(date: Date): string {
	const y = date.getFullYear();
	const m = `${date.getMonth() + 1}`.padStart(2, '0');
	const d = `${date.getDate()}`.padStart(2, '0');
	return `${y}-${m}-${d}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function weekdayName(date: string): string {
	return WEEKDAYS[parseDate(date).getDay()];
}

export function weekdayShort(date: string): string {
	return WEEKDAYS_SHORT[parseDate(date).getDay()];
}

export function monthName(date: string): string {
	return MONTHS[parseDate(date).getMonth()];
}

/** "Mon, 7 September 2026" */
export function longDate(date: string): string {
	const d = parseDate(date);
	return `${weekdayShort(date)}, ${d.getDate()} ${monthName(date)} ${d.getFullYear()}`;
}

/** "7 September 2026" */
export function fullDate(date: string): string {
	const d = parseDate(date);
	return `${d.getDate()} ${monthName(date)} ${d.getFullYear()}`;
}

export function addDays(date: string, delta: number): string {
	const d = parseDate(date);
	d.setDate(d.getDate() + delta);
	return toISODate(d);
}

export function compareDates(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

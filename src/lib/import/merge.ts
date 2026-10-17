import type { DecodedRoutine } from '#lib/codec/payload';
import { emptyCell, type Cell, type ClassRow, type Day, type Workspace } from '#lib/model/types';

export interface MergeOptions {
	/** "new" creates (or fills) the day matching the payload date. */
	target: 'new' | 'replace';
	/** Required when target is "replace". */
	dayId?: string;
	/** Adopt the payload's period labels and colour split, or fit into ours. */
	layout: 'keep' | 'adopt';
}

export interface MergeSummary {
	dayId: string;
	date: string;
	periodsAdopted: boolean;
	classesAdded: number;
	subjectsAdded: number;
	teachersAdded: number;
	cellsFilled: number;
	cellsDropped: number;
	replacedExistingDay: boolean;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function resize(cells: Cell[], length: number): Cell[] {
	if (cells.length === length) return cells;
	if (cells.length > length) return cells.slice(0, length);
	return [...cells, ...Array.from({ length: length - cells.length }, emptyCell)];
}

/**
 * Fold an imported routine into the workspace.
 *
 * The result is a whole new workspace document, so the caller can push it onto
 * the undo stack in one step and a bad import is one Ctrl Z away.
 */
export function mergeDecoded(
	ws: Workspace,
	decoded: DecodedRoutine,
	options: MergeOptions
): { ws: Workspace; summary: MergeSummary } {
	const next = clone(ws);
	const summary: MergeSummary = {
		dayId: '',
		date: decoded.date,
		periodsAdopted: false,
		classesAdded: 0,
		subjectsAdded: 0,
		teachersAdded: 0,
		cellsFilled: 0,
		cellsDropped: 0,
		replacedExistingDay: false
	};

	/* Periods -------------------------------------------------------------- */

	if (options.layout === 'adopt' && decoded.periods.length) {
		next.periods = [...decoded.periods];
		next.groupSplit = Math.max(1, Math.min(decoded.groupSplit || 1, next.periods.length - 1 || 1));
		if (decoded.groupNames[0] || decoded.groupNames[1]) {
			next.groupNames = [
				decoded.groupNames[0] || next.groupNames[0],
				decoded.groupNames[1] || next.groupNames[1]
			];
		}
		summary.periodsAdopted = true;
		for (const day of next.days) {
			for (const row of next.classes) {
				day.grid[row.id] = resize(day.grid[row.id] ?? [], next.periods.length);
			}
		}
	}
	const columns = next.periods.length;

	/* Dictionaries --------------------------------------------------------- */

	for (const subject of decoded.subjects) {
		if (!subject || next.subjects.includes(subject)) continue;
		next.subjects.push(subject);
		summary.subjectsAdded++;
	}
	for (const teacher of decoded.teachers) {
		if (!teacher || next.teachers.includes(teacher)) continue;
		next.teachers.push(teacher);
		summary.teachersAdded++;
	}

	/* Classes -------------------------------------------------------------- */

	const classIds: string[] = [];
	decoded.classes.forEach((row, index) => {
		const match = next.classes.find((c) => c.grade === row.grade && c.section === row.section);
		if (match) {
			classIds.push(match.id);
			return;
		}
		const created: ClassRow = {
			id: `i${Date.now().toString(36)}${index}`,
			grade: row.grade,
			section: row.section,
			school: 'All'
		};
		next.classes.push(created);
		classIds.push(created.id);
		summary.classesAdded++;
		for (const day of next.days) {
			day.grid[created.id] = Array.from({ length: columns }, emptyCell);
		}
	});

	/* Cells ---------------------------------------------------------------- */

	const grid: Record<string, Cell[]> = {};
	for (const row of next.classes) grid[row.id] = Array.from({ length: columns }, emptyCell);

	decoded.grid.forEach((row, rowIndex) => {
		const classId = classIds[rowIndex];
		if (!classId) return;
		row.forEach((cell, period) => {
			if (period >= columns) {
				if (cell.entries.length || cell.mark !== 'none') summary.cellsDropped++;
				return;
			}
			const entries = cell.entries.filter((entry) => entry.subject || entry.teacher);
			const mark = cell.mark;
			if (!entries.length && mark === 'none') return;
			grid[classId][period] = {
				entries: entries.map((entry) => ({ subject: entry.subject, teacher: entry.teacher })),
				mark
			};
			summary.cellsFilled++;
		});
	});

	/* Day ------------------------------------------------------------------ */

	let day: Day | undefined;
	let replacedExistingDay = false;
	if (options.target === 'replace' && options.dayId) {
		day = next.days.find((d) => d.id === options.dayId);
	}
	if (!day) {
		const existing = next.days.find((d) => d.date === decoded.date);
		if (existing) {
			day = existing;
			replacedExistingDay = true;
		} else {
			day = { id: `d${next.days.length + 1}`, date: decoded.date, grid: {} };
			next.days.push(day);
		}
	}
	day.grid = grid;
	if (options.target === 'new') {
		// The imported routine carries the school day it belongs to.
		day.date = decoded.date;
	}
	next.days.sort((a, b) => (a.date < b.date ? -1 : 1));
	summary.dayId = day.id;
	summary.date = day.date;
	summary.replacedExistingDay = replacedExistingDay;

	return { ws: next, summary };
}

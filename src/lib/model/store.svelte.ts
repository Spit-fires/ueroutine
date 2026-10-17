import {
	emptyCell,
	sortRoster,
	toISODate,
	type Cell,
	type ClassRow,
	type Day,
	type Entry,
	type Selection,
	type Workspace
} from './types';
import { buildPeriods, createInitialWorkspace, workbookDayToDay, type WorkbookDay } from './seed';

const STORAGE_KEY = 'utsaho.routine-desk.v1';
const HISTORY_LIMIT = 80;

export interface Notice {
	id: number;
	message: string;
	tone: 'info' | 'good' | 'warn' | 'bad';
}

export interface DeskStats {
	cells: number;
	filled: number;
	dual: number;
	black: number;
}

/** Teacher shorthand such as "SIT/YA" means two teachers sharing the slot. */
export function splitTeachers(teacher: string): string[] {
	return teacher
		.split('/')
		.map((t) => t.trim())
		.filter(Boolean);
}

function deepClone<T>(source: T): T {
	return JSON.parse(JSON.stringify(source)) as T;
}

class RoutineDesk {
	workspace = $state<Workspace>(createInitialWorkspace());
	/** The day the desk is showing. */
	currentDayId = $state<string>('');
	selection = $state<Selection | null>(null);
	clipboard = $state<Cell | null>(null);
	notices = $state<Notice[]>([]);
	focusInspector = $state(0);
	hydrated = $state(false);

	#past: Workspace[] = [];
	#future: Workspace[] = [];
	#historyVersion = $state(0);
	#noticeId = 0;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		if (typeof window !== 'undefined') {
			this.#restore();
			this.hydrated = true;
		}
		this.currentDayId = this.workspace.days[0]?.id ?? '';
	}

	/* ----------------------------------------------------------- lifecycle -- */

	#restore() {
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Workspace;
			if (!parsed?.classes?.length || !parsed.days?.length) return;
			this.workspace = this.#normalise(parsed);
		} catch (error) {
			console.warn('[routine-desk] could not restore saved routine', error);
		}
	}

	/** Fill in anything a stored/imported workspace is missing and keep grids rectangular. */
	#normalise(input: Workspace): Workspace {
		const base = createInitialWorkspace();
		const noSlash = (names: string[]) => names.filter((name) => !name.includes('/'));
		const ws: Workspace = {
			...base,
			...input,
			periods: input.periods?.length ? input.periods : base.periods,
			groupNames: input.groupNames ?? base.groupNames,
			band: { ...base.band, ...(input.band ?? {}) },
			subjects: sortRoster(noSlash(input.subjects?.length ? input.subjects : base.subjects)),
			teachers: sortRoster(noSlash(input.teachers?.length ? input.teachers : base.teachers)),
			classes: (input.classes?.length ? input.classes : base.classes).map((c) => ({
				...c,
				// Workbook sections are legacy noise; the school tag is the only
				// label the grid and the export show.
				section: '',
				school: c.school || 'All'
			}))
		};
		const columns = ws.periods.length;
		ws.days = (input.days ?? []).map((day, index) => {
			const grid: Record<string, Cell[]> = {};
			for (const row of ws.classes) {
				const existing = day.grid?.[row.id] ?? [];
				grid[row.id] = Array.from({ length: columns }, (_, p) => existing[p] ?? emptyCell());
			}
			return { id: day.id || `d${index + 1}`, date: day.date || toISODate(new Date()), grid };
		});
		if (!ws.days.length) ws.days = base.days;
		ws.days.sort((a, b) => (a.date < b.date ? -1 : 1));
		return ws;
	}

	persist() {
		if (typeof window === 'undefined' || !this.hydrated) return;
		if (this.#saveTimer) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(this.workspace)));
			} catch (error) {
				console.warn('[routine-desk] could not save routine', error);
			}
		}, 250);
	}

	/* ------------------------------------------------------------- history -- */

	#snapshot(): Workspace {
		return deepClone($state.snapshot(this.workspace));
	}

	/** Record the current state so the next mutation can be undone. */
	push() {
		this.#past.push(this.#snapshot());
		if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
		this.#future = [];
		this.#historyVersion++;
	}

	mutate(fn: (ws: Workspace) => void) {
		this.push();
		fn(this.workspace);
		this.persist();
	}

	get canUndo(): boolean {
		void this.#historyVersion;
		return this.#past.length > 0;
	}

	get canRedo(): boolean {
		void this.#historyVersion;
		return this.#future.length > 0;
	}

	get historyDepth(): number {
		void this.#historyVersion;
		return this.#past.length;
	}

	undo() {
		const previous = this.#past.pop();
		if (!previous) return;
		this.#future.push(this.#snapshot());
		this.workspace = this.#normalise(previous);
		this.#clampSelection();
		this.#historyVersion++;
		this.persist();
	}

	redo() {
		const next = this.#future.pop();
		if (!next) return;
		this.#past.push(this.#snapshot());
		this.workspace = this.#normalise(next);
		this.#clampSelection();
		this.#historyVersion++;
		this.persist();
	}

	#clampSelection() {
		if (!this.dayById(this.currentDayId)) {
			this.currentDayId = this.workspace.days[0]?.id ?? '';
		}
		const sel = this.selection;
		if (!sel) return;
		const day = this.dayById(sel.dayId);
		const row = this.classById(sel.classId);
		if (!day || !row || sel.period >= this.workspace.periods.length) this.selection = null;
	}

	/* ---------------------------------------------------------- navigation -- */

	get currentDay(): Day {
		return this.dayById(this.currentDayId) ?? this.workspace.days[0];
	}

	setCurrentDay(dayId: string) {
		this.currentDayId = dayId;
		if (this.selection && this.selection.dayId !== dayId) this.selection = null;
	}

	/** Select an existing day for a date, creating it when it is missing. */
	goToDate(date: string): Day {
		const existing = this.dayByDate(date);
		if (existing) {
			this.setCurrentDay(existing.id);
			return existing;
		}
		const created = this.addDay(date);
		this.setCurrentDay(created.id);
		return created;
	}

	stepDay(delta: number) {
		const index = this.workspace.days.findIndex((d) => d.id === this.currentDayId);
		const next = this.workspace.days[index + delta];
		if (next) this.setCurrentDay(next.id);
	}

	/* --------------------------------------------------------- descriptors -- */

	get periods(): string[] {
		return this.workspace.periods;
	}

	get classes(): ClassRow[] {
		return this.workspace.classes;
	}

	get days(): Day[] {
		return this.workspace.days;
	}

	dayById(id: string): Day | undefined {
		return this.workspace.days.find((d) => d.id === id);
	}

	dayByDate(date: string): Day | undefined {
		return this.workspace.days.find((d) => d.date === date);
	}

	classById(id: string): ClassRow | undefined {
		return this.workspace.classes.find((c) => c.id === id);
	}

	get selectedDay(): Day | undefined {
		const sel = this.selection;
		return sel ? this.dayById(sel.dayId) : undefined;
	}

	get selectedCell(): Cell | undefined {
		const sel = this.selection;
		if (!sel) return undefined;
		return this.cellAt(sel.dayId, sel.classId, sel.period);
	}

	cellAt(dayId: string, classId: string, period: number): Cell | undefined {
		return this.dayById(dayId)?.grid[classId]?.[period];
	}

	select(selection: Selection | null) {
		this.selection = selection;
	}

	moveSelection(dx: number, dy: number) {
		const sel = this.selection;
		if (!sel) return;
		const rowIndex = this.workspace.classes.findIndex((c) => c.id === sel.classId);
		if (rowIndex < 0) return;
		const nextRow = Math.min(this.workspace.classes.length - 1, Math.max(0, rowIndex + dy));
		const nextPeriod = Math.min(this.workspace.periods.length - 1, Math.max(0, sel.period + dx));
		this.selection = {
			dayId: sel.dayId,
			classId: this.workspace.classes[nextRow].id,
			period: nextPeriod
		};
	}

	stepPeriod(direction: number) {
		this.moveSelection(direction, 0);
	}

	/* -------------------------------------------------------- cell editing -- */

	setEntry(index: number, field: keyof Entry, value: string) {
		const sel = this.selection;
		if (!sel) return;
		this.mutate((ws) => {
			const cell = ws.days.find((d) => d.id === sel.dayId)?.grid[sel.classId]?.[sel.period];
			if (!cell) return;
			if (!cell.entries[index]) cell.entries[index] = { subject: '', teacher: '' };
			cell.entries[index][field] = value;
			// Keep the cell tidy: a blank entry with no sibling has nothing to show.
			cell.entries = cell.entries.filter((e, i) => i === index || e.subject || e.teacher);
			if (cell.entries.length > 2) cell.entries.length = 2;
		});
	}

	addEntry() {
		const sel = this.selection;
		if (!sel) return;
		this.mutate((ws) => {
			const cell = ws.days.find((d) => d.id === sel.dayId)?.grid[sel.classId]?.[sel.period];
			if (!cell || cell.entries.length >= 2) return;
			// A split must land: an empty cell gets both blanks at once.
			const count = cell.entries.length === 0 ? 2 : 1;
			cell.entries = [
				...cell.entries,
				...Array.from({ length: count }, () => ({ subject: '', teacher: '' }))
			];
		});
	}

	removeEntry(index: number) {
		const sel = this.selection;
		if (!sel) return;
		this.mutate((ws) => {
			const cell = ws.days.find((d) => d.id === sel.dayId)?.grid[sel.classId]?.[sel.period];
			if (!cell) return;
			cell.entries.splice(index, 1);
			if (!cell.entries.length) cell.black = false;
		});
	}

	setBlack(black: boolean) {
		const sel = this.selection;
		if (!sel) return;
		this.mutate((ws) => {
			const cell = ws.days.find((d) => d.id === sel.dayId)?.grid[sel.classId]?.[sel.period];
			if (!cell) return;
			cell.black = black;
		});
	}

	toggleBlack() {
		const cell = this.selectedCell;
		if (!cell) return;
		this.setBlack(!cell.black);
	}

	clearCell(
		dayId = this.selection?.dayId,
		classId = this.selection?.classId,
		period = this.selection?.period
	) {
		if (!dayId || !classId || period === undefined) return;
		this.mutate((ws) => {
			const day = ws.days.find((d) => d.id === dayId);
			if (!day) return;
			day.grid[classId][period] = emptyCell();
		});
	}

	copyCell() {
		const cell = this.selectedCell;
		if (!cell) return;
		this.clipboard = deepClone($state.snapshot(cell));
		this.flash('Cell copied — paste with Ctrl V', 'info');
	}

	pasteCell() {
		const sel = this.selection;
		const source = this.clipboard;
		if (!sel || !source) return;
		this.mutate((ws) => {
			const day = ws.days.find((d) => d.id === sel.dayId);
			if (!day) return;
			day.grid[sel.classId][sel.period] = deepClone(source);
		});
	}

	/* ------------------------------------------------------------ day ops -- */

	addDay(date: string): Day {
		let created: Day | undefined;
		this.mutate((ws) => {
			const periods = ws.periods.length;
			const grid: Record<string, Cell[]> = {};
			for (const row of ws.classes) grid[row.id] = Array.from({ length: periods }, emptyCell);
			created = { id: this.#nextDayId(ws), date, grid };
			ws.days.push(created);
			ws.days.sort((a, b) => (a.date < b.date ? -1 : 1));
		});
		return created ?? this.workspace.days[0];
	}

	#nextDayId(ws: Workspace): string {
		let n = ws.days.length + 1;
		const ids = new Set(ws.days.map((d) => d.id));
		while (ids.has(`d${n}`)) n++;
		return `d${n}`;
	}

	removeDay(dayId: string) {
		this.mutate((ws) => {
			if (ws.days.length <= 1) return;
			ws.days = ws.days.filter((d) => d.id !== dayId);
		});
		if (this.selection?.dayId === dayId) this.selection = null;
	}

	clearDay(dayId: string) {
		this.mutate((ws) => {
			const day = ws.days.find((d) => d.id === dayId);
			if (!day) return;
			for (const row of ws.classes) {
				day.grid[row.id] = Array.from({ length: ws.periods.length }, emptyCell);
			}
		});
	}

	setDayDate(dayId: string, date: string) {
		this.mutate((ws) => {
			const day = ws.days.find((d) => d.id === dayId);
			if (day) day.date = date;
			ws.days.sort((a, b) => (a.date < b.date ? -1 : 1));
		});
	}

	/** Copy an entire routine (optionally from another day) onto a target date. */
	duplicateDay(sourceDayId: string, targetDate: string): Day | undefined {
		const source = this.dayById(sourceDayId);
		if (!source) return undefined;
		let newId = '';
		this.mutate((ws) => {
			const existing = ws.days.find((d) => d.date === targetDate);
			const grid = deepClone($state.snapshot(source.grid)) as Record<string, Cell[]>;
			for (const row of ws.classes) {
				grid[row.id] ??= Array.from({ length: ws.periods.length }, emptyCell);
				grid[row.id] = grid[row.id].slice(0, ws.periods.length);
			}
			if (existing) {
				existing.grid = grid;
				newId = existing.id;
			} else {
				newId = this.#nextDayId(ws);
				ws.days.push({ id: newId, date: targetDate, grid });
				ws.days.sort((a, b) => (a.date < b.date ? -1 : 1));
			}
		});
		return this.dayById(newId);
	}

	/** Overwrite a day with data from the source workbook (spreadsheet import). */
	loadWorkbookDay(
		entry: WorkbookDay,
		target: string | 'new'
	): { placed: number; dropped: number; dayId: string } {
		const result = workbookDayToDay(
			entry,
			this.workspace.classes,
			this.workspace.periods.length,
			'pending'
		);
		let dayId = '';
		this.mutate((ws) => {
			const existing = target === 'new' ? ws.days.find((d) => d.date === entry.date) : undefined;
			dayId = target === 'new' ? (existing?.id ?? this.#nextDayId(ws)) : target;
			const day: Day = { id: dayId, date: entry.date, grid: result.day.grid };
			const index = ws.days.findIndex((d) => d.id === dayId);
			if (index >= 0) ws.days[index] = day;
			else ws.days.push(day);
			ws.days.sort((a, b) => (a.date < b.date ? -1 : 1));
		});
		this.setCurrentDay(dayId);
		return { placed: result.placed, dropped: result.dropped, dayId };
	}

	/* --------------------------------------------------------- layout ops -- */

	setPeriodCount(count: number) {
		const next = Math.max(1, Math.min(24, Math.round(count)));
		this.mutate((ws) => {
			if (next === ws.periods.length) return;
			const current = ws.periods;
			if (next > current.length) {
				const extra = buildPeriods(next, current[0] ?? '9:00 AM', 30).slice(current.length);
				ws.periods = [...current, ...extra];
			} else {
				ws.periods = current.slice(0, next);
			}
			ws.groupSplit = Math.max(1, Math.min(ws.groupSplit, ws.periods.length - 1 || 1));
			for (const day of ws.days) {
				for (const row of ws.classes) {
					const cells = day.grid[row.id] ?? [];
					if (next > cells.length) {
						day.grid[row.id] = [
							...cells,
							...Array.from({ length: next - cells.length }, emptyCell)
						];
					} else {
						day.grid[row.id] = cells.slice(0, next);
					}
				}
			}
		});
	}

	regeneratePeriods(start: string, stepMinutes: number) {
		this.mutate((ws) => {
			ws.periods = buildPeriods(ws.periods.length, start, stepMinutes);
		});
	}

	setPeriodLabel(index: number, label: string) {
		this.mutate((ws) => {
			ws.periods[index] = label;
		});
	}

	setGroupSplit(split: number) {
		this.mutate((ws) => {
			ws.groupSplit = Math.max(1, Math.min(split, Math.max(1, ws.periods.length - 1)));
		});
	}

	setGroupNames(names: [string, string]) {
		this.mutate((ws) => {
			ws.groupNames = names;
		});
	}

	setSchool(name: string) {
		this.mutate((ws) => {
			ws.school = name;
		});
	}

	setBand(patch: Partial<Workspace['band']>) {
		this.mutate((ws) => {
			ws.band = { ...ws.band, ...patch };
		});
	}

	/* --------------------------------------------------------- class rows -- */

	addClass(grade = '', school = 'All') {
		this.mutate((ws) => {
			const next = Math.max(0, ...ws.classes.map((row) => Number(row.grade) || 0)) + 1;
			const row: ClassRow = {
				id: `c${Date.now().toString(36)}`,
				grade: grade || String(next),
				section: '',
				school
			};
			ws.classes.push(row);
			for (const day of ws.days) {
				day.grid[row.id] = Array.from({ length: ws.periods.length }, emptyCell);
			}
		});
	}

	updateClass(id: string, patch: Partial<Omit<ClassRow, 'id'>>) {
		this.mutate((ws) => {
			const row = ws.classes.find((c) => c.id === id);
			if (!row) return;
			Object.assign(row, patch);
			ws.classes.sort((a, b) => {
				const ga = Number(a.grade);
				const gb = Number(b.grade);
				if (Number.isFinite(ga) && Number.isFinite(gb) && ga !== gb) return ga - gb;
				return a.section.localeCompare(b.section);
			});
		});
	}

	removeClass(id: string) {
		this.mutate((ws) => {
			if (ws.classes.length <= 1) return;
			ws.classes = ws.classes.filter((c) => c.id !== id);
			for (const day of ws.days) delete day.grid[id];
		});
		if (this.selection?.classId === id) this.selection = null;
	}

	moveClass(id: string, delta: number) {
		this.mutate((ws) => {
			const index = ws.classes.findIndex((c) => c.id === id);
			const target = index + delta;
			if (index < 0 || target < 0 || target >= ws.classes.length) return;
			const [row] = ws.classes.splice(index, 1);
			ws.classes.splice(target, 0, row);
		});
	}

	/** Rename a class row and carry every cell across to the new key. */
	rekeyClass(id: string, nextId: string) {
		if (id === nextId) return;
		this.mutate((ws) => {
			const row = ws.classes.find((c) => c.id === id);
			if (!row || ws.classes.some((c) => c.id === nextId)) return;
			row.id = nextId;
			for (const day of ws.days) {
				day.grid[nextId] = day.grid[id];
				delete day.grid[id];
			}
		});
		if (this.selection?.classId === id) this.selection = { ...this.selection, classId: nextId };
	}

	/* ------------------------------------------------- subjects & teachers -- */

	addSubject(name: string) {
		const value = name.trim();
		if (!value || this.workspace.subjects.includes(value)) return;
		this.mutate((ws) => {
			ws.subjects = sortRoster([...ws.subjects, value]);
		});
	}

	renameSubject(from: string, to: string) {
		const value = to.trim();
		if (!from || !value || from === value) return;
		this.mutate((ws) => {
			ws.subjects = sortRoster(ws.subjects.map((s) => (s === from ? value : s)));
			for (const day of ws.days) {
				for (const row of ws.classes) {
					for (const cell of day.grid[row.id] ?? []) {
						for (const entry of cell.entries) {
							if (entry.subject === from) entry.subject = value;
						}
					}
				}
			}
		});
	}

	removeSubject(name: string) {
		this.mutate((ws) => {
			ws.subjects = ws.subjects.filter((s) => s !== name);
		});
	}

	addTeacher(name: string) {
		const value = name.trim();
		if (!value || this.workspace.teachers.includes(value)) return;
		this.mutate((ws) => {
			ws.teachers = sortRoster([...ws.teachers, value]);
		});
	}

	renameTeacher(from: string, to: string) {
		const value = to.trim();
		if (!from || !value || from === value) return;
		this.mutate((ws) => {
			ws.teachers = sortRoster(ws.teachers.map((t) => (t === from ? value : t)));
			for (const day of ws.days) {
				for (const row of ws.classes) {
					for (const cell of day.grid[row.id] ?? []) {
						for (const entry of cell.entries) {
							if (entry.teacher === from) entry.teacher = value;
						}
					}
				}
			}
		});
	}

	removeTeacher(name: string) {
		this.mutate((ws) => {
			ws.teachers = ws.teachers.filter((t) => t !== name);
		});
	}

	/* ---------------------------------------------------------- whole doc -- */

	replaceWorkspace(next: Workspace, remember = true) {
		if (remember) this.push();
		this.workspace = this.#normalise(next);
		this.selection = null;
		this.persist();
	}

	toJSON(): Workspace {
		return this.#snapshot();
	}

	stats(dayId?: string): DeskStats {
		const day = dayId ? this.dayById(dayId) : (this.selectedDay ?? this.workspace.days[0]);
		const stats: DeskStats = { cells: 0, filled: 0, dual: 0, black: 0 };
		if (!day) return stats;
		for (const row of this.workspace.classes) {
			for (const cell of day.grid[row.id] ?? []) {
				stats.cells++;
				const hasText = cell.entries.some((e) => e.subject || e.teacher);
				if (hasText || cell.black) stats.filled++;
				if (cell.entries.length > 1) stats.dual++;
				if (cell.black) stats.black++;
			}
		}
		return stats;
	}

	/* -------------------------------------------------------------- notice -- */

	flash(message: string, tone: Notice['tone'] = 'info') {
		const id = ++this.#noticeId;
		this.notices = [...this.notices, { id, message, tone }];
		setTimeout(() => {
			this.notices = this.notices.filter((n) => n.id !== id);
		}, 4200);
	}
}

export const desk = new RoutineDesk();
export type { Entry };

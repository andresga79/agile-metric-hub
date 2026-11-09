import { sprintCloseTime, type JiraSprint } from "../jira";

export type SprintWindowSize = 3 | 6 | 12;

export interface SprintWindow {
  display: JiraSprint[];
  recent: JiraSprint[];
  previous: JiraSprint[];
  active: JiraSprint | null;
}

export function selectSprintWindow(all: JiraSprint[], size: SprintWindowSize): SprintWindow {
  const closed = all
    .filter((s) => s.state === "closed")
    .map((s) => ({ s, t: sprintCloseTime(s)?.getTime() ?? 0 }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.s);
  const display = closed.slice(-size);
  const active = all.find((s) => s.state === "active") ?? null;

  if (display.length < size) return { display, recent: display, previous: [], active };

  const half = size === 3 ? 3 : size / 2;
  const recent = display.slice(-half);
  const previous =
    size === 3
      ? closed.slice(Math.max(0, closed.length - 6), closed.length - 3)
      : display.slice(0, display.length - half);
  return { display, recent, previous, active };
}

export function parseSprintWindow(raw: unknown): SprintWindowSize {
  const n = Number(raw);
  return n === 3 || n === 6 || n === 12 ? n : 6;
}

export function parseDayWindow(raw: unknown): 30 | 90 | 180 {
  const n = Number(raw);
  return n === 30 || n === 90 || n === 180 ? n : 90;
}

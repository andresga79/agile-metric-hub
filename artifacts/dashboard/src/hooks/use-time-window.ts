import { useState } from "react";
import type { TimeWindow } from "@/components/time-window-filter";

type BoardType = "scrum" | "kanban" | "simple" | string | null | undefined;

const isSprintWindow = (w: TimeWindow) => w === "2s" || w === "6s";
const ALL_WINDOWS: readonly TimeWindow[] = ["1m", "3m", "2s", "6s"];

/** `?period=` from the URL, so a link can open a page on a given window (the Resumen Ejecutivo
 *  links each project to its closest match of its own 90-day window: 6s for Scrum, 3m otherwise). */
function windowFromUrl(): TimeWindow | null {
  const value = new URLSearchParams(window.location.search).get("period");
  return value && (ALL_WINDOWS as readonly string[]).includes(value) ? (value as TimeWindow) : null;
}

/** The selected time window for a project page, or null until the project's boardType is known.
 *  Pages used to start at "1m" and flip Scrum projects to "2s" in an effect once the project
 *  loaded - so every Scrum tab fired its heavy requests twice, and the un-aborted 1m response
 *  could land after the 2s one and render 1m numbers under the "Últimos 2" label. Callers gate
 *  their queries on a non-null window instead. The user's choice is kept only while it's valid
 *  for the board type (sprint windows for Scrum, 1m/3m otherwise). */
export function useTimeWindow(boardType: BoardType): [TimeWindow | null, (w: TimeWindow) => void] {
  const [selected, setSelected] = useState<TimeWindow | null>(windowFromUrl);
  if (!boardType) return [null, setSelected];

  const isScrum = boardType === "scrum";
  const fallback: TimeWindow = isScrum ? "2s" : "1m";
  const valid = selected !== null && isSprintWindow(selected) === isScrum;
  return [valid ? selected : fallback, setSelected];
}

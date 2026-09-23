import { useState } from "react";
import type { TimeWindow } from "@/components/time-window-filter";

type BoardType = "scrum" | "kanban" | "simple" | string | null | undefined;

const isSprintWindow = (w: TimeWindow) => w === "2s" || w === "6s";

/** The selected time window for a project page, or null until the project's boardType is known.
 *  Pages used to start at "1m" and flip Scrum projects to "2s" in an effect once the project
 *  loaded - so every Scrum tab fired its heavy requests twice, and the un-aborted 1m response
 *  could land after the 2s one and render 1m numbers under the "Últimos 2" label. Callers gate
 *  their queries on a non-null window instead. The user's choice is kept only while it's valid
 *  for the board type (sprint windows for Scrum, 1m/3m otherwise). */
export function useTimeWindow(boardType: BoardType): [TimeWindow | null, (w: TimeWindow) => void] {
  const [selected, setSelected] = useState<TimeWindow | null>(null);
  if (!boardType) return [null, setSelected];

  const isScrum = boardType === "scrum";
  const fallback: TimeWindow = isScrum ? "2s" : "1m";
  const valid = selected !== null && isSprintWindow(selected) === isScrum;
  return [valid ? selected : fallback, setSelected];
}

import { useQuery } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/auth";

export interface MetricThreshold {
  good: number;
  warning: number;
}

type EffectiveThresholdsResponse = Record<string, { goodValue: number; warningValue: number; isOverride: boolean }>;

/** Effective metric thresholds (Admin -> Health global defaults with this project's overrides
 *  applied, resolved server-side by getEffectiveThresholds), keyed by metric. Single source for
 *  every screen: each page used to merge /api/admin/metric-thresholds + the project overrides on
 *  its own, and those endpoints are admin-only - members got 403 and silently saw factory
 *  defaults instead of the configured values. Omit projectId for global-only (portfolio views).
 *  Empty until loaded; callers spread it over their own defaults. Cached per project across tabs. */
export function useThresholds(projectId?: string): Record<string, MetricThreshold> {
  const { data } = useQuery({
    queryKey: ["effective-thresholds", projectId ?? null],
    queryFn: async (): Promise<Record<string, MetricThreshold>> => {
      const url = projectId ? `/api/projects/${projectId}/thresholds` : "/api/thresholds";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
      if (!res.ok) throw new Error(`Thresholds request failed: ${res.status}`);
      const body = (await res.json()) as EffectiveThresholdsResponse;
      const out: Record<string, MetricThreshold> = {};
      for (const [metric, t] of Object.entries(body)) {
        out[metric] = { good: Number(t.goodValue), warning: Number(t.warningValue) };
      }
      return out;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? EMPTY;
}

const EMPTY: Record<string, MetricThreshold> = {};

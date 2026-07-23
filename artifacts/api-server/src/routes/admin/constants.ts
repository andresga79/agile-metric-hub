export const VALID_ROLES = ["admin", "member", "viewer"] as const;

export const SECTIONS = [
  "team",
  "health",
  "analytics",
  "flow",
  "forecast",
  "report",
  "qa-rejected",
  "sprints",
  "kanban",
  "targets",
] as const;

export const DEFAULT_PERMISSIONS: {
  role: string;
  section: string;
  canView: boolean;
  canEdit: boolean;
}[] = [
  ...VALID_ROLES.flatMap((role) =>
    SECTIONS.map((section) => ({
      role,
      section,
      canView: role === "admin" || role === "member",
      canEdit: false,
    }))
  ),
];

// All metrics use a "lower is better" or "higher is better" direction (see LOWER_BETTER/HIGHER_BETTER
// in admin.tsx and use-health-suggestions.ts). goodValue/warningValue are the two cutoffs that split
// values into ok / warning / critical bands.
//
// - blocked is a PERCENTAGE of current WIP (blocked issues / WIP * 100), not an absolute issue count —
//   an absolute count doesn't mean the same thing in a 10-issue project as in a 200-issue one.
// - flowLoad (WIP / throughput) and wipAging (days an issue has sat in an in-progress status) are new:
//   previously hardcoded in dashboard.tsx / analytics.ts, now admin-configurable like everything else.
export const DEFAULT_HEALTH_THRESHOLDS: {
  metric: string;
  goodValue: number;
  warningValue: number;
}[] = [
  { metric: "cycleTime", goodValue: 15, warningValue: 25 },
  { metric: "leadTime", goodValue: 25, warningValue: 35 },
  { metric: "throughput", goodValue: 10, warningValue: 5 },
  { metric: "wipRatio", goodValue: 30, warningValue: 50 },
  { metric: "cfr", goodValue: 10, warningValue: 25 },
  { metric: "predictability", goodValue: 70, warningValue: 40 },
  { metric: "flowEfficiency", goodValue: 25, warningValue: 15 },
  { metric: "blocked", goodValue: 0, warningValue: 15 },
  { metric: "flowLoad", goodValue: 1.2, warningValue: 2.0 },
  { metric: "wipAging", goodValue: 3, warningValue: 14 },
];

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

export const DEFAULT_HEALTH_THRESHOLDS: {
  metric: string;
  goodValue: number;
  warningValue: number;
}[] = [
  { metric: "cycleTime", goodValue: 15, warningValue: 25 },
  { metric: "leadTime", goodValue: 20, warningValue: 35 },
  { metric: "throughput", goodValue: 10, warningValue: 5 },
  { metric: "wipRatio", goodValue: 30, warningValue: 50 },
  { metric: "cfr", goodValue: 10, warningValue: 25 },
  { metric: "predictability", goodValue: 70, warningValue: 40 },
  { metric: "flowEfficiency", goodValue: 40, warningValue: 20 },
  { metric: "blocked", goodValue: 0, warningValue: 3 },
];

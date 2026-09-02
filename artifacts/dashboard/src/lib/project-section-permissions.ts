import { useQuery } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/auth";

export const SECTION_NAMES = [
  "health",
  "flow",
  "forecast",
  "sprints",
  "kanban",
  "evolution",
  "team",
  "qa-rejected",
  "qa-work",
  "analytics",
  "report",
  "targets",
] as const;

export type ProjectSection = (typeof SECTION_NAMES)[number];

export type Role = "admin" | "member" | "viewer";

export interface PermissionEntry {
  id: number;
  role: string;
  section: string;
  canView: boolean;
  canEdit: boolean;
}

const defaultPermissions: PermissionEntry[] = [
  ...(["admin", "member"] as const).flatMap((role) =>
    SECTION_NAMES.filter((s) => s !== "targets").map((section) => ({
      id: 0, role, section, canView: true, canEdit: false,
    }))
  ),
  ...(["viewer"] as const).map((role) => ({
    id: 0, role, section: "", canView: false, canEdit: false,
  })),
];

export function useRolePermissions() {
  return useQuery<PermissionEntry[]>({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) return [];
      const res = await fetch("/api/role-permissions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function canAccessSection(
  role: string | undefined,
  section: ProjectSection,
  permissions: PermissionEntry[],
): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  const entry = permissions.find((p) => p.role === role && p.section === section);
  return entry?.canView ?? false;
}

export function canEditSection(
  role: string | undefined,
  section: ProjectSection,
  permissions: PermissionEntry[],
): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  const entry = permissions.find((p) => p.role === role && p.section === section);
  return entry?.canEdit ?? false;
}

export function getSectionLinks(
  role: string | undefined,
  projectId: string,
  permissions: PermissionEntry[],
  boardType?: string,
): { href: string; label: string; section: ProjectSection }[] {
  const links = [
    { href: `/projects/${projectId}/health`, label: "Health", section: "health" as ProjectSection },
    { href: `/projects/${projectId}/flow`, label: "Flow", section: "flow" as ProjectSection },
    { href: `/projects/${projectId}/forecast`, label: "Forecast", section: "forecast" as ProjectSection },
    {
      href: boardType === "scrum" ? `/projects/${projectId}/sprints` : `/projects/${projectId}/kanban`,
      label: boardType === "scrum" ? "Sprints" : "Kanban Weekly",
      section: boardType === "scrum" ? "sprints" as ProjectSection : "kanban" as ProjectSection,
    },
    { href: `/projects/${projectId}/evolution`, label: "Evolucion", section: "evolution" as ProjectSection },
    { href: `/projects/${projectId}/team`, label: "Team", section: "team" as ProjectSection },
    { href: `/projects/${projectId}/qa-rejected`, label: "QA Rejected", section: "qa-rejected" as ProjectSection },
    { href: `/projects/${projectId}/qa-work`, label: "QA", section: "qa-work" as ProjectSection },
    { href: `/projects/${projectId}/analytics`, label: "Analytics", section: "analytics" as ProjectSection },
    { href: `/projects/${projectId}/report`, label: "Report", section: "report" as ProjectSection },
  ];
  return links.filter((l) => canAccessSection(role, l.section, permissions));
}

import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { ChevronDown, BarChart3, HeartPulse, GitPullRequest, Activity, Users, FileText, ShieldAlert, TrendingUp } from "lucide-react";
import { getSectionLinks, useRolePermissions, type ProjectSection } from "@/lib/project-section-permissions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const ORDERED_SECTIONS = [
  'health', 'evolution', 'flow', 'team', 'sprints', 'kanban',
  'qa-rejected', 'forecast', 'analytics', 'report',
] as const;
const PRIMARY_TAB_SECTIONS = ['health', 'flow', 'team', 'sprints', 'kanban', 'evolution'];
const SECONDARY_TAB_SECTIONS = ['forecast', 'qa-rejected', 'analytics', 'report'];

const TAB_ICON_MAP: Record<string, React.ReactNode> = {
  sprints: <BarChart3 size={16} />,
  kanban: <BarChart3 size={16} />,
  flow: <GitPullRequest size={16} />,
  health: <HeartPulse size={16} />,
  team: <Users size={16} />,
  evolution: <TrendingUp size={16} />,
};

const DROPDOWN_ICON_MAP: Record<string, React.ReactNode> = {
  forecast: <Activity size={14} />,
  analytics: <BarChart3 size={14} />,
  report: <FileText size={14} />,
  "qa-rejected": <ShieldAlert size={14} />,
};

const TAB_CLASS = "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors";
const TAB_ACTIVE_CLASS = `${TAB_CLASS} bg-primary/10 text-primary font-semibold`;
const TAB_INACTIVE_CLASS = `${TAB_CLASS} text-muted-foreground hover:text-foreground hover:bg-accent`;

/** Shared per-project navigation - renders on every project sub-page so a user
 *  can jump directly between sections instead of returning to the summary first. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: "summary" | ProjectSection }) {
  const { t } = useTranslation();
  const token = localStorage.getItem("auth_token");

  const { data: currentUser } = useGetCurrentUser({
    query: { enabled: !!token, queryKey: getGetCurrentUserQueryKey() },
  });
  const { data: permissions } = useRolePermissions();
  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId) },
  });

  const sectionLinks = getSectionLinks(currentUser?.role, projectId, permissions ?? [], project?.boardType);
  const orderIndex = new Map<string, number>(ORDERED_SECTIONS.map((section, index) => [section, index]));
  const orderedLinks = [...sectionLinks].sort(
    (left, right) => (orderIndex.get(left.section) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(right.section) ?? Number.MAX_SAFE_INTEGER)
  );

  const primaryLinks = orderedLinks.filter((l) => PRIMARY_TAB_SECTIONS.includes(l.section));
  const secondaryLinks = orderedLinks.filter((l) => SECONDARY_TAB_SECTIONS.includes(l.section));
  const isSecondaryActive = active !== "summary" && SECONDARY_TAB_SECTIONS.includes(active);

  return (
    <div className="flex items-center gap-1 flex-wrap mb-4">
      <Link href={`/projects/${projectId}`} className={active === "summary" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}>
        {t('page.detail.summaryTab')}
      </Link>
      {primaryLinks.map((link) => (
        <Link key={link.section} href={link.href} className={active === link.section ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}>
          {TAB_ICON_MAP[link.section] ?? null}
          {link.label}
        </Link>
      ))}
      {secondaryLinks.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className={`${isSecondaryActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS} gap-1`}>
            {t('common.more')}
            <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {secondaryLinks.map((link) => (
              <DropdownMenuItem key={link.section} asChild>
                <Link href={link.href} className="flex items-center gap-2 cursor-pointer">
                  {DROPDOWN_ICON_MAP[link.section] ?? null}
                  {link.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

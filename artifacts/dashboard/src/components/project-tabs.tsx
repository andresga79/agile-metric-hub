import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { ChevronDown, BarChart3, GitPullRequest, Users, FileText, ShieldCheck, Timer } from "lucide-react";
import { getSectionLinks, useRolePermissions, type ProjectSection } from "@/lib/project-section-permissions";
import { DataFreshness } from "@/components/data-freshness";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

/** A primary tab that groups several sections; each section is a sub-view (its page keeps its URL)
 *  and the sub-views are switched with ProjectSubNav. Extra sub-views that have no section of their
 *  own (e.g. SLA) borrow the permission of `extras[].section`. */
interface TabGroup {
  key: "quality" | "delivery";
  labelKey: string;
  icon: React.ReactNode;
  sections: ProjectSection[];
  extras?: { key: string; labelKey: string; path: string; section: ProjectSection }[];
}

export const TAB_GROUPS: TabGroup[] = [
  {
    key: "quality",
    labelKey: "nav.quality",
    icon: <ShieldCheck size={16} />,
    sections: ["qa-rejected", "qa-work"],
    extras: [{ key: "sla", labelKey: "nav.sla", path: "sla", section: "qa-rejected" }],
  },
  {
    key: "delivery",
    labelKey: "nav.delivery",
    icon: <BarChart3 size={16} />,
    // getSectionLinks only returns sprints (Scrum) or kanban (Kanban), and capacity only for Scrum.
    sections: ["sprints", "kanban", "capacity", "forecast"],
  },
];

/** Primary order. Group keys stand for their whole group. */
const PRIMARY_ORDER: string[] = ["health", "flow", "team", "delivery", "quality"];
const SECONDARY_TAB_SECTIONS: string[] = ["analytics", "report"];

const TAB_ICON_MAP: Record<string, React.ReactNode> = {
  flow: <GitPullRequest size={16} />,
  health: <Timer size={16} />,
  team: <Users size={16} />,
};

const DROPDOWN_ICON_MAP: Record<string, React.ReactNode> = {
  analytics: <BarChart3 size={14} />,
  report: <FileText size={14} />,
};

const TAB_CLASS = "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors";
const TAB_ACTIVE_CLASS = `${TAB_CLASS} bg-primary/10 text-primary font-semibold`;
const TAB_INACTIVE_CLASS = `${TAB_CLASS} text-muted-foreground hover:text-foreground hover:bg-accent`;

function groupOf(section: string): TabGroup | undefined {
  return TAB_GROUPS.find((g) => (g.sections as string[]).includes(section));
}

function useProjectLinks(projectId: string) {
  const token = localStorage.getItem("auth_token");
  const { data: currentUser } = useGetCurrentUser({
    query: { enabled: !!token, queryKey: getGetCurrentUserQueryKey() },
  });
  const { data: permissions } = useRolePermissions();
  const { data: project } = useGetProject(projectId, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId) },
  });
  return getSectionLinks(currentUser?.role, projectId, permissions ?? [], project?.boardType);
}

/** Shared per-project navigation - renders on every project sub-page so a user
 *  can jump directly between sections instead of returning to the summary first. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: "summary" | ProjectSection }) {
  const { t } = useTranslation();
  const sectionLinks = useProjectLinks(projectId);

  type Tab = { key: string; href: string; label: string; icon: React.ReactNode; isActive: boolean };
  const tabs: Tab[] = [];
  const seenGroups = new Set<string>();
  for (const link of sectionLinks) {
    const group = groupOf(link.section);
    if (group) {
      if (seenGroups.has(group.key)) continue;
      seenGroups.add(group.key);
      // The group tab opens its first permitted sub-view, in the group's own order (Entrega before
      // Pronóstico), not in getSectionLinks' order.
      const first = group.sections.map((sec) => sectionLinks.find((l) => l.section === sec)).find(Boolean) ?? link;
      tabs.push({
        key: group.key,
        href: first.href,
        label: t(group.labelKey),
        icon: group.icon,
        isActive: active !== "summary" && (group.sections as string[]).includes(active),
      });
    } else if (!SECONDARY_TAB_SECTIONS.includes(link.section)) {
      tabs.push({ key: link.section, href: link.href, label: link.label, icon: TAB_ICON_MAP[link.section] ?? null, isActive: active === link.section });
    }
  }
  const rank = (k: string) => {
    const i = PRIMARY_ORDER.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  tabs.sort((a, b) => rank(a.key) - rank(b.key));

  const secondaryLinks = sectionLinks.filter((l) => SECONDARY_TAB_SECTIONS.includes(l.section) && !groupOf(l.section));
  const isSecondaryActive = active !== "summary" && secondaryLinks.some((l) => l.section === active);

  return (
    <div className="flex items-center gap-1 flex-wrap mb-4">
      <Link href={`/projects/${projectId}`} className={active === "summary" ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}>
        {t('page.detail.summaryTab')}
      </Link>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className={tab.isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}>
          {tab.icon}
          {tab.label}
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
      <DataFreshness projectId={projectId} />
    </div>
  );
}

const SUB_CLASS = "text-xs font-medium px-3 py-1 rounded-full border transition-colors";
const SUB_ACTIVE = `${SUB_CLASS} border-primary/40 bg-primary/10 text-primary`;
const SUB_INACTIVE = `${SUB_CLASS} border-border text-muted-foreground hover:text-foreground hover:bg-accent`;

/** Sub-views of a grouped tab (e.g. Calidad: Rechazos QA · Trabajo QA · SLA), shown under the tabs.
 *  `active` is the page's section, or an extra's key (e.g. "sla"). Only permitted sub-views appear. */
export function ProjectSubNav({ projectId, group, active }: { projectId: string; group: TabGroup["key"]; active: string }) {
  const { t } = useTranslation();
  const sectionLinks = useProjectLinks(projectId);
  const def = TAB_GROUPS.find((g) => g.key === group);
  if (!def) return null;
  const permitted = new Set(sectionLinks.map((l) => l.section));
  const items = [
    ...sectionLinks
      .filter((l) => (def.sections as string[]).includes(l.section))
      .map((l) => ({ key: l.section as string, href: l.href, label: t(`nav.sub.${l.section}`) })),
    ...(def.extras ?? [])
      .filter((e) => permitted.has(e.section))
      .map((e) => ({ key: e.key, href: `/projects/${projectId}/${e.path}`, label: t(e.labelKey) })),
  ];
  if (items.length < 2) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap -mt-2 mb-4">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={i.key === active ? SUB_ACTIVE : SUB_INACTIVE}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

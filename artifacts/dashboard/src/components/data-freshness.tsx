import { useTranslation } from "react-i18next";
import { useGetProjectFreshness, getGetProjectFreshnessQueryKey } from "@workspace/api-client-react";

function age(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return t("page.freshness.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("page.freshness.hours", { count: hours });
  return t("page.freshness.days", { count: Math.floor(hours / 24) });
}

/** "Datos de Jira: hace 2 h (12/11 10:40)" for a project; amber when older than 24 h. */
export function DataFreshness({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data } = useGetProjectFreshness(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectFreshnessQueryKey(projectId), staleTime: 5 * 60 * 1000 },
  });
  if (!data) return null;
  const when = data.fetchedAt
    ? `${age(data.fetchedAt, t)} (${new Date(data.fetchedAt).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})`
    : "—";
  return (
    <span
      className={`ml-auto text-[11px] whitespace-nowrap ${data.stale ? "text-amber-600 dark:text-yellow-300 font-medium" : "text-muted-foreground"}`}
      title={data.stale ? t("page.freshness.staleTitle") : undefined}
    >
      {t("page.freshness.label")}: {when}
    </span>
  );
}

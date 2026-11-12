import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAuthToken } from "@/lib/auth";
import { useThresholds } from "@/hooks/use-thresholds";
import type { TimeWindow } from "@/components/time-window-filter";

interface SlaRow {
  priority: string;
  total: number;
  withinSla: number;
  percentage: number;
}

const DEFAULT_SLA_THRESHOLD = { good: 90, warning: 70 };

/** SLA compliance by priority (moved from Analytics to Calidad). Same source: GET /sla/:period. */
export function SlaSection({ projectId, period }: { projectId: string; period: TimeWindow }) {
  const { t } = useTranslation();
  const thresholds = useThresholds(projectId);
  const slaThreshold = thresholds.slaCompliance ?? DEFAULT_SLA_THRESHOLD;
  const [rows, setRows] = useState<SlaRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!projectId || !token) return;
    let superseded = false;
    setRows(null);
    setFailed(false);
    fetch(`/api/projects/${projectId}/sla/${period}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`SLA request failed: ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!superseded) setRows(Array.isArray(json?.sla) ? json.sla : []);
      })
      .catch((err) => {
        console.error(err);
        if (!superseded) setFailed(true);
      });
    return () => {
      superseded = true;
    };
  }, [projectId, period]);

  return (
    <Card className="bg-card/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer size={18} />
          {t("page.analytics.slaTitle")}
        </CardTitle>
        <CardDescription>{t("page.analytics.slaDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-muted-foreground py-4">{t("page.detail.blocked.unavailable")}</p>
        ) : rows === null ? (
          <div className="h-24 bg-muted animate-pulse rounded" />
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>{t("page.analytics.priority")}</TableHead>
                  <TableHead className="text-right">{t("page.analytics.total")}</TableHead>
                  <TableHead className="text-right">{t("page.analytics.withinSla")}</TableHead>
                  <TableHead className="text-right">{t("page.analytics.compliance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.priority} className="border-border hover:bg-accent/50">
                    <TableCell className="font-medium">{s.priority}</TableCell>
                    <TableCell className="text-right">{s.total}</TableCell>
                    <TableCell className="text-right">{s.withinSla}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-mono ${s.percentage >= slaThreshold.good ? "text-green-400" : s.percentage >= slaThreshold.warning ? "text-amber-400" : "text-red-400"}`}>
                        {s.percentage}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4">{t("page.analytics.noSlaData")}</p>
        )}
      </CardContent>
    </Card>
  );
}

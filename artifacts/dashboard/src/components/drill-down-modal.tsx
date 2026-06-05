import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DrillDownModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  week: string;
  period: string;
}

export function DrillDownModal({ open, onClose, projectId, week, period }: DrillDownModalProps) {
  const { t } = useTranslation();
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectId || !week) return;
    setLoading(true);
    const token = localStorage.getItem("auth_token");
    fetch(`/api/projects/${projectId}/issues-by-week?week=${week}&period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setIssues(d.issues ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, projectId, week, period]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold">{t('page.drillDown.title', { week })}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          {loading ? (
            <p className="text-muted-foreground">{t('page.drillDown.loading')}</p>
          ) : issues.length === 0 ? (
            <p className="text-muted-foreground">{t('page.drillDown.noIssues')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.drillDown.key')}</TableHead>
                    <TableHead>{t('page.drillDown.summary')}</TableHead>
                    <TableHead>{t('page.drillDown.type')}</TableHead>
                    <TableHead>{t('page.drillDown.priority')}</TableHead>
                    <TableHead>{t('page.drillDown.assignee')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((i: any) => (
                    <TableRow key={i.key} className="border-border hover:bg-accent/50">
                      <TableCell className="font-mono text-xs text-primary">{i.key}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={i.summary}>{i.summary}</TableCell>
                      <TableCell>{i.issueType}</TableCell>
                      <TableCell>{i.priority}</TableCell>
                      <TableCell>{i.assignee ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

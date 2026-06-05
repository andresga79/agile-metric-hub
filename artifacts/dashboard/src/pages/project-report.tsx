import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectMetrics, getGetProjectMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Download } from "lucide-react";

type Period = "1m" | "3m" | "6m";

export default function ProjectReport() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [generating, setGenerating] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  const handleExport = async () => {
    if (!reportRef.current) return;
    setGenerating(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${project?.key ?? projectId}-report-${period}.pdf`);
    } catch (e) {
      console.error("PDF generation failed", e);
    }
    setGenerating(false);
  };

  if (!project) return <div>{t('common.loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.report.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.report.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m", "6m"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={handleExport}
            disabled={generating || !metrics}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            <Download size={14} />
            {generating ? t('page.report.generating') : t('page.report.pdf')}
          </button>
        </div>
      </div>

      <div ref={reportRef} className="space-y-4 bg-white text-black p-8 rounded-lg">
        <div className="text-center border-b border-gray-300 pb-4 mb-4">
          <h2 className="text-2xl font-bold">{project.name}</h2>
          <p className="text-sm text-gray-500">{t('page.report.reportTitle')} — {period.toUpperCase()}</p>
          <p className="text-xs text-gray-400">{new Date().toLocaleDateString()}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.throughput')}</div>
            <div className="text-xl font-bold">{metrics?.throughput.toFixed(1)} /wk</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.cycleTime')}</div>
            <div className="text-xl font-bold">{metrics?.cycleTime.toFixed(1)}d</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.leadTime')}</div>
            <div className="text-xl font-bold">{metrics?.leadTime.toFixed(1)}d</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.resolved')}</div>
            <div className="text-xl font-bold">{metrics?.resolvedCount}</div>
          </div>
        </div>

        <div className="border border-gray-200 rounded p-3">
          <h3 className="text-sm font-semibold mb-2">{t('page.report.doraTitle')}</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>{t('page.report.deploymentFreq')}: <strong>{metrics?.dora.deploymentFrequency.toFixed(1)}/wk</strong></div>
            <div>{t('page.report.leadTimeChanges')}: <strong>{metrics?.dora.leadTimeForChanges.toFixed(1)}d</strong></div>
            <div>{t('page.report.changeFailureRate')}: <strong>{metrics?.dora.changeFailureRate.toFixed(1)}%</strong></div>
            <div>{t('page.report.mttr')}: <strong>{metrics?.dora.mttr.toFixed(1)}d</strong></div>
          </div>
        </div>

        <div className="border border-gray-200 rounded p-3">
          <h3 className="text-sm font-semibold mb-2">{t('page.report.percentiles')}</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Cycle Time P50: <strong>{metrics?.cycleTimePercentiles.p50.toFixed(1)}d</strong> P95: <strong>{metrics?.cycleTimePercentiles.p95.toFixed(1)}d</strong></div>
            <div>Lead Time P50: <strong>{metrics?.leadTimePercentiles.p50.toFixed(1)}d</strong> P95: <strong>{metrics?.leadTimePercentiles.p95.toFixed(1)}d</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

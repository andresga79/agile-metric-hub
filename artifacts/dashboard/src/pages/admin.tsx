import { useTranslation } from "react-i18next";
import { useState, useCallback, useEffect } from "react";
import {
  useListAdminUsers,
  useCreateAdminUser,
  useUpdateAdminUser,
  useDeleteAdminUser,
  getListAdminUsersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, Pencil, Trash2, Shield, ShieldAlert, Save, Activity } from "lucide-react";
import { useRolePermissions, type PermissionEntry } from "@/lib/project-section-permissions";
import { useToast } from "@/hooks/use-toast";

interface ThresholdRow {
  metric: string;
  goodValue: number;
  warningValue: number;
}

interface IssueTypeOption {
  value: string;
  label: string;
}

interface PortfolioRecalculationStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastCalculatedAt: string | null;
  cachedProjects: number;
  lastError: string | null;
}

const LOWER_BETTER = ["cycleTime", "leadTime", "cfr", "wipRatio", "blocked"];
const HIGHER_BETTER = ["throughput", "predictability", "flowEfficiency"];

const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  cycleTime: { label: "Cycle Time", unit: "d" },
  leadTime: { label: "Lead Time", unit: "d" },
  throughput: { label: "Throughput", unit: "/sem" },
  wipRatio: { label: "WIP Balance", unit: "%" },
  cfr: { label: "Calidad (CFR)", unit: "%" },
  predictability: { label: "Predictabilidad", unit: "" },
  flowEfficiency: { label: "Flow Efficiency", unit: "%" },
  blocked: { label: "Issues Bloqueados", unit: "" },
};

const ISSUE_TYPE_OPTIONS: IssueTypeOption[] = [
  { value: "Story", label: "HU / Story" },
  { value: "Task", label: "Task" },
  { value: "Bug", label: "Bug" },
  { value: "Epic", label: "Epic" },
  { value: "Sub-task", label: "Sub-task" },
  { value: "Spike", label: "Spike" },
];

export default function Admin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: users, isLoading } = useListAdminUsers();
  const createMutation = useCreateAdminUser();
  const updateMutation = useUpdateAdminUser();
  const deleteMutation = useDeleteAdminUser();

  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "member" as string });

  const { data: permissions, refetch: refetchPermissions } = useRolePermissions();
  const [localPerms, setLocalPerms] = useState<PermissionEntry[]>([]);

  const [thresholds, setThresholds] = useState<ThresholdRow[]>([]);
  const [thresholdsDirty, setThresholdsDirty] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [allowedIssueTypes, setAllowedIssueTypes] = useState<string[]>([]);
  const [issueTypesDirty, setIssueTypesDirty] = useState(false);
  const [savingIssueTypes, setSavingIssueTypes] = useState(false);
  const [newIssueType, setNewIssueType] = useState("");
  const [issueTypeError, setIssueTypeError] = useState<string | null>(null);
  const [recalculationStatus, setRecalculationStatus] = useState<PortfolioRecalculationStatus | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/admin/metric-thresholds", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setThresholds(data.map((t: any) => ({
            metric: t.metric,
            goodValue: Number(t.goodValue),
            warningValue: Number(t.warningValue),
          })));
        }
      })
      .catch(() => {});
  }, []);

  const fetchPortfolioRecalculationStatus = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    try {
      const response = await fetch("/api/admin/portfolio/recalculate-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      setRecalculationStatus(data);
    } catch {
      // Keep previous status if request fails
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/admin/portfolio/issue-types", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.issueTypes)) {
          setAllowedIssueTypes(data.issueTypes);
        }
      })
      .catch(() => {});

    fetchPortfolioRecalculationStatus();
  }, [fetchPortfolioRecalculationStatus]);

  useEffect(() => {
    if (!recalculationStatus?.running) return;

    const timer = setInterval(() => {
      fetchPortfolioRecalculationStatus();
    }, 4000);

    return () => clearInterval(timer);
  }, [recalculationStatus?.running, fetchPortfolioRecalculationStatus]);

  const updateThreshold = (metric: string, field: "goodValue" | "warningValue", value: number) => {
    setThresholds((prev) => prev.map((t) => t.metric === metric ? { ...t, [field]: value } : t));
    setThresholdsDirty(true);
  };

  const saveAllThresholds = async () => {
    const token = localStorage.getItem("auth_token");
    setSavingThresholds(true);
    for (const t of thresholds) {
      try {
        await fetch(`/api/admin/metric-thresholds/${t.metric}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ goodValue: t.goodValue, warningValue: t.warningValue }),
        });
      } catch {}
    }
    setSavingThresholds(false);
    setThresholdsDirty(false);
  };

  const toggleIssueType = (issueType: string) => {
    setIssueTypeError(null);
    setAllowedIssueTypes((prev) => {
      const exists = prev.some((i) => i.toLowerCase() === issueType.toLowerCase());
      if (exists) {
        if (prev.length === 1) {
          setIssueTypeError("Debes mantener al menos un tipo de issue");
          return prev;
        }
        setIssueTypesDirty(true);
        return prev.filter((i) => i.toLowerCase() !== issueType.toLowerCase());
      }

      setIssueTypesDirty(true);
      return [...prev, issueType];
    });
  };

  const addCustomIssueType = () => {
    const trimmed = newIssueType.trim();
    if (!trimmed) return;

    const exists = allowedIssueTypes.some((i) => i.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setIssueTypeError("Ese tipo de issue ya esta agregado");
      return;
    }

    setIssueTypeError(null);
    setAllowedIssueTypes((prev) => [...prev, trimmed]);
    setIssueTypesDirty(true);
    setNewIssueType("");
  };

  const removeCustomIssueType = (issueType: string) => {
    if (allowedIssueTypes.length === 1) {
      setIssueTypeError("Debes mantener al menos un tipo de issue");
      return;
    }
    setIssueTypeError(null);
    setAllowedIssueTypes((prev) => prev.filter((i) => i.toLowerCase() !== issueType.toLowerCase()));
    setIssueTypesDirty(true);
  };

  const saveIssueTypes = async () => {
    const token = localStorage.getItem("auth_token");
    setSavingIssueTypes(true);
    setIssueTypeError(null);

    try {
      const response = await fetch("/api/admin/portfolio/issue-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ issueTypes: allowedIssueTypes }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMessage = data?.error ?? "No se pudo guardar la configuracion";
        setIssueTypeError(errorMessage);
        toast({
          title: "No se pudo guardar",
          description: errorMessage,
          variant: "destructive",
        });
        return;
      }

      if (Array.isArray(data?.issueTypes)) {
        setAllowedIssueTypes(data.issueTypes);
      }
      setIssueTypesDirty(false);
      toast({
        title: "Configuracion guardada",
        description: "El recálculo de portfolio se inició en background.",
      });
      fetchPortfolioRecalculationStatus();
    } catch {
      setIssueTypeError("No se pudo guardar la configuracion");
      toast({
        title: "Error de red",
        description: "No se pudo guardar la configuración de issue types.",
        variant: "destructive",
      });
    } finally {
      setSavingIssueTypes(false);
    }
  };

  useEffect(() => {
    if (permissions) setLocalPerms(permissions);
  }, [permissions]);

  const savePermission = useCallback(async (id: number, canView: boolean, canEdit: boolean) => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/admin/role-permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, canView, canEdit }),
    });
    if (res.ok) {
      const updated = await res.json();
      setLocalPerms((prev) => prev.map((p) => p.id === id ? updated : p));
    }
  }, []);

  const handleToggleView = (entry: PermissionEntry) => {
    const next = !entry.canView;
    if (!next) {
      // If unchecking view, also uncheck edit
      savePermission(entry.id, false, false);
    } else {
      savePermission(entry.id, true, entry.canEdit);
    }
  };

  const handleToggleEdit = (entry: PermissionEntry) => {
    // Enabling edit also enables view
    savePermission(entry.id, true, !entry.canEdit);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
  };

  const handleCreate = () => {
    createMutation.mutate(
      { data: { username: form.username, email: form.email, password: form.password, role: form.role as "admin" | "member" | "viewer" } },
      {
        onSuccess: () => { setShowForm(false); setForm({ username: "", email: "", password: "", role: "member" }); invalidate(); },
      }
    );
  };

  const handleUpdate = () => {
    if (!editingUser) return;
    const payload: any = {};
    if (form.username) payload.username = form.username;
    if (form.email) payload.email = form.email;
    if (form.password) payload.password = form.password;
    if (form.role) payload.role = form.role;
    if (Object.keys(payload).length === 0) return;
    updateMutation.mutate(
      { userId: editingUser.id, data: payload },
      {
        onSuccess: () => { setEditingUser(null); setForm({ username: "", email: "", password: "", role: "member" }); invalidate(); },
      }
    );
  };

  const startEdit = (user: any) => {
    setEditingUser(user);
    setForm({ username: user.username, email: user.email, password: "", role: user.role });
  };

  const handleDelete = (userId: number) => {
    if (!window.confirm(t('page.admin.confirmDelete'))) return;
    deleteMutation.mutate(
      { userId },
      { onSuccess: () => invalidate() }
    );
  };

  if (isLoading) return <div>{t('common.loading')}</div>;

  const adminCount = users?.filter((u) => u.role === "admin").length ?? 0;
  const memberCount = users?.filter((u) => u.role === "member").length ?? 0;
  const viewerCount = users?.filter((u) => u.role === "viewer").length ?? 0;

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.admin.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.admin.subtitle')}</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setEditingUser(null); setForm({ username: "", email: "", password: "", role: "member" }); }}
          className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/80 px-3 py-1.5 rounded-md transition-colors"
        >
          <UserPlus size={14} />
          {showForm ? t('page.admin.cancel') : t('page.admin.addUser')}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.admin.totalUsers')}</CardTitle>
            <Shield size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{users?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.admin.admins')}</CardTitle>
            <ShieldAlert size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-400">{adminCount}</div>
            <p className="text-xs text-muted-foreground mt-1">{memberCount} {t('page.admin.members')}, {viewerCount} {t('page.admin.viewers')}</p>
          </CardContent>
        </Card>
      </div>

      {(showForm || editingUser) && (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>{editingUser ? t('page.admin.editUser') : t('page.admin.addNewUser')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('page.admin.username')}</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  placeholder={t('page.admin.username')}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('page.admin.email')}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  placeholder={t('page.admin.email')}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('page.admin.password')}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  placeholder={editingUser ? t('page.admin.leaveEmpty') : t('page.admin.password')}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('page.admin.role')}</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm"
                  >
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button
                  onClick={editingUser ? handleUpdate : handleCreate}
                  className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm"
                >
                  {editingUser ? t('page.admin.save') : t('page.admin.create')}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg">{t('page.admin.users')}</CardTitle>
          <CardDescription>{t('page.admin.manageAccess')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>{t('page.admin.username')}</TableHead>
                  <TableHead>{t('page.admin.email')}</TableHead>
                  <TableHead>{t('page.admin.role')}</TableHead>
                  <TableHead>{t('page.admin.created')}</TableHead>
                  <TableHead className="text-right">{t('page.admin.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id} className="border-border hover:bg-accent/50">
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === "admin" ? "bg-amber-500/15 text-amber-400" :
                        u.role === "member" ? "bg-blue-500/15 text-blue-400" :
                        "bg-slate-500/15 text-slate-400"
                      }`}>
                        {u.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(u)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          title={t('page.admin.editUserTitle')}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(u.id)}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive transition-colors"
                          title={t('page.admin.deleteUser')}
                          disabled={u.username === "admin"}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg">{t('page.admin.rolePermissions')}</CardTitle>
          <CardDescription>{t('page.admin.permissionsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>Role</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-center">View</TableHead>
                  <TableHead className="text-center">Edit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localPerms.map((entry) => (
                  <TableRow key={entry.id || `${entry.role}-${entry.section}`} className="border-border hover:bg-accent/50">
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        entry.role === "admin" ? "bg-amber-500/15 text-amber-400" :
                        entry.role === "member" ? "bg-blue-500/15 text-blue-400" :
                        "bg-slate-500/15 text-slate-400"
                      }`}>
                        {entry.role}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium capitalize">{entry.section || "—"}</TableCell>
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        checked={entry.canView}
                        disabled={entry.role === "admin"}
                        onChange={() => handleToggleView(entry)}
                        className="w-4 h-4 accent-primary"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        checked={entry.canEdit}
                        disabled={entry.role === "admin"}
                        onChange={() => handleToggleEdit(entry)}
                        className="w-4 h-4 accent-primary"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t('page.admin.adminFullAccess')}</p>
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity size={18} className="text-primary" />
                {t('page.admin.healthThresholds')}
              </CardTitle>
              <CardDescription>{t('page.admin.thresholdsDesc')}</CardDescription>
            </div>
            {thresholdsDirty && (
              <button
                onClick={saveAllThresholds}
                disabled={savingThresholds}
                className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/80 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                {savingThresholds ? t('common.loading') : t('page.admin.saveThresholds')}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>{t('page.admin.metric')}</TableHead>
                  <TableHead className="text-center">{t('page.admin.good')}</TableHead>
                  <TableHead className="text-center">{t('page.admin.warning')}</TableHead>
                  <TableHead className="text-center text-xs text-muted-foreground">{t('page.admin.direction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {thresholds.map((row) => {
                  const meta = METRIC_LABELS[row.metric] ?? { label: row.metric, unit: "" };
                  const isLower = LOWER_BETTER.includes(row.metric);
                  return (
                    <TableRow key={row.metric} className="border-border hover:bg-accent/50">
                      <TableCell className="font-medium">{meta.label}</TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1">
                          <span className={`text-xs ${isLower ? "text-green-400" : "text-green-400"}`}>
                            {isLower ? "≤" : "≥"}
                          </span>
                          <input
                            type="number"
                            value={row.goodValue}
                            onChange={(e) => updateThreshold(row.metric, "goodValue", Number(e.target.value))}
                            className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-sm text-center tabular-nums"
                          />
                          <span className="text-xs text-muted-foreground">{meta.unit}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-xs text-amber-400">
                            {isLower ? "≤" : "≥"}
                          </span>
                          <input
                            type="number"
                            value={row.warningValue}
                            onChange={(e) => updateThreshold(row.metric, "warningValue", Number(e.target.value))}
                            className="w-16 bg-background border border-border rounded px-1.5 py-0.5 text-sm text-center tabular-nums"
                          />
                          <span className="text-xs text-muted-foreground">{meta.unit}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isLower ? "bg-blue-500/15 text-blue-400" : "bg-purple-500/15 text-purple-400"
                        }`}>
                          {isLower ? t('page.admin.lowerBetter') : t('page.admin.higherBetter')}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Filtro De Issue Types Para Portfolio</CardTitle>
              <CardDescription>
                Define que tipos de issue se consideran en los calculos de issue count, done, in progress y throughput.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${
                  recalculationStatus?.running
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-emerald-500/15 text-emerald-400"
                }`}
              >
                {recalculationStatus?.running ? "Recalculando" : "En espera"}
              </span>
              {issueTypesDirty && (
                <button
                  onClick={saveIssueTypes}
                  disabled={savingIssueTypes}
                  className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/80 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                >
                  <Save size={14} />
                  {savingIssueTypes ? t('common.loading') : "Guardar Y Recalcular"}
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ISSUE_TYPE_OPTIONS.map((option) => {
              const checked = allowedIssueTypes.some((i) => i.toLowerCase() === option.value.toLowerCase());
              return (
                <label
                  key={option.value}
                  className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm cursor-pointer hover:bg-accent/40"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleIssueType(option.value)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={newIssueType}
              onChange={(e) => setNewIssueType(e.target.value)}
              placeholder="Agregar tipo custom (ej: Chore)"
              className="w-full sm:max-w-xs bg-background border border-border rounded px-2 py-1.5 text-sm"
            />
            <button
              onClick={addCustomIssueType}
              className="bg-secondary text-secondary-foreground px-3 py-1.5 rounded text-sm hover:bg-secondary/80"
            >
              Agregar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {allowedIssueTypes.map((issueType) => {
              const isPreset = ISSUE_TYPE_OPTIONS.some((opt) => opt.value.toLowerCase() === issueType.toLowerCase());
              return (
                <span
                  key={issueType}
                  className="inline-flex items-center gap-1 rounded bg-accent/50 px-2 py-1 text-xs"
                >
                  {issueType}
                  {!isPreset && (
                    <button
                      onClick={() => removeCustomIssueType(issueType)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Quitar tipo"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {issueTypeError && <p className="text-xs text-destructive">{issueTypeError}</p>}

          <div className="rounded border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <p>Estado: {recalculationStatus?.running ? "Recalculando portfolio" : "Sin recálculo en curso"}</p>
            <p>Ultimo calculo completado: {formatDateTime(recalculationStatus?.lastCalculatedAt ?? null)}</p>
            <p>Ultima ejecucion finalizada: {formatDateTime(recalculationStatus?.finishedAt ?? null)}</p>
            <p>Proyectos cacheados: {recalculationStatus?.cachedProjects ?? 0}</p>
            {recalculationStatus?.lastError && (
              <p className="text-destructive">Ultimo error: {recalculationStatus.lastError}</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Al guardar se actualiza la configuracion y se lanza el recalculo de portfolio en background.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

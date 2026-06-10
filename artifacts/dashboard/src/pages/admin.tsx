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

interface ThresholdRow {
  metric: string;
  goodValue: number;
  warningValue: number;
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

export default function Admin() {
  const { t } = useTranslation();
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
    </div>
  );
}

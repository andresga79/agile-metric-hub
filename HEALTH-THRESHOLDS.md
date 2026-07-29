# Umbrales de Salud (Admin → Health) — valores personalizados

> Snapshot tomado el 2026-07-29 desde el Postgres local. Ver arquitectura completa del
> sistema de thresholds en `CLAUDE.md` ("Architecture decisions") y las fórmulas de cada
> métrica en `METRICS.md`.

## Por qué existe este archivo

Los 17 umbrales globales (`default_metric_thresholds`, `project_id IS NULL`) se
**auto-siembran solos** en cualquier Postgres nuevo, tomando los valores de
`DEFAULT_HEALTH_THRESHOLDS` en `artifacts/api-server/src/routes/admin/constants.ts`
(`ensureGlobalDefaultsSeeded()`, corre en cada arranque del API). Eso es automático — **no
hace falta este archivo para eso.**

Pero 4 métricas fueron **editadas manualmente** desde Admin → Health y hoy difieren del
default de fábrica. Esas ediciones viven **solo en la fila existente de la DB** — el seed
automático nunca pisa una fila que ya existe (solo inserta las que faltan). Si armás el
proyecto en una PC nueva con un Postgres vacío, vas a arrancar con los defaults de fábrica
para estas 4, no con los valores de abajo, hasta que los reconfigures a mano o corras el
script de este archivo.

## Valores actuales vs. default de fábrica

| Métrica | Bueno (actual) | Advertencia (actual) | Bueno (default código) | Advertencia (default código) | ¿Personalizado? |
|---|---:|---:|---:|---:|:---:|
| `cycleTime` | 5 | 7 | 15 | 25 | ✅ Sí |
| `leadTime` | 10 | 15 | 25 | 35 | ✅ Sí |
| `flowEfficiency` | 40 | 20 | 25 | 15 | ✅ Sí |
| `blocked` | 0 | 1 | 0 | 15 | ✅ Sí |
| `throughput` | 10 | 5 | 10 | 5 | No |
| `wipRatio` | 30 | 50 | 30 | 50 | No |
| `cfr` | 10 | 25 | 10 | 25 | No |
| `predictability` | 70 | 40 | 70 | 40 | No |
| `flowLoad` | 1.2 | 2 | 1.2 | 2 | No |
| `wipAging` | 3 | 14 | 3 | 14 | No |
| `sprintCompletion` | 80 | 50 | 80 | 50 | No |
| `slaHighest` (horas) | 4 | 4 | 4 | 4 | No |
| `slaHigh` (días) | 1 | 1 | 1 | 1 | No |
| `slaMedium` (días) | 3 | 3 | 3 | 3 | No |
| `slaLow` (días) | 5 | 5 | 5 | 5 | No |
| `slaLowest` (días) | 10 | 10 | 10 | 10 | No |
| `slaCompliance` | 90 | 70 | 90 | 70 | No |

No hay overrides por proyecto configurados (`project_id`) — todos los 17 son globales.

## Cómo restaurarlos en una PC nueva

Solo hace falta para las 4 métricas personalizadas. Dos formas:

**Opción A — desde la UI** (más simple, sin tocar la DB directo): Admin → Health, editar
`cycleTime` (5/7), `leadTime` (10/15), `flowEfficiency` (40/20), `blocked` (0/1).

**Opción B — SQL directo**, útil si preferís scriptearlo al levantar el proyecto por
primera vez en la PC nueva (después de `docker compose up -d --build`, con el contenedor
`db` corriendo):

```bash
docker exec -i agile_metrics_db psql -U agile_user -d agile_metrics <<'SQL'
INSERT INTO default_metric_thresholds (metric, project_id, good_value, warning_value)
VALUES
  ('cycleTime', NULL, 5, 7),
  ('leadTime', NULL, 10, 15),
  ('flowEfficiency', NULL, 40, 20),
  ('blocked', NULL, 0, 1)
ON CONFLICT (metric, project_id) DO UPDATE
  SET good_value = EXCLUDED.good_value,
      warning_value = EXCLUDED.warning_value,
      updated_at = now();
SQL
```

Ajustá `agile_metrics_db` / `agile_user` / `agile_metrics` si cambiaste esos nombres en
`.env` respecto de los defaults de `docker-compose.yml`.

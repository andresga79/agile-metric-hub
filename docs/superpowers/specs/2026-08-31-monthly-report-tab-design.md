# Diseño: Tab "Informe" (reporte mensual) por proyecto

Fecha: 2026-08-31
Origen: sesión donde se armó a mano un informe de Olimpo (OLP, proyecto 10003)
como artifact HTML, combinando datos del dashboard con datos de Jira que hoy
la app no sincroniza (goal del sprint activo, releases del proyecto RC).
Este spec lleva ese informe a una vista nativa dentro de Agile Metric Hub.

## Objetivo

Agregar un tab **"Informe"** a la vista de proyecto (junto a Resumen, Health,
Evolucion, Flow, Team, Sprints) que muestre, sin intervención manual:

1. Avances y funcionalidades del período (sprints cerrados + en curso).
2. Decisiones importantes — observaciones auto-generadas a partir de cambios
   significativos en las métricas ya calculadas.
3. Bloqueos e impedimentos activos, con su motivo.
4. Objetivo del sprint activo (goal).
5. Próximos pasos a producción — releases del proyecto Jira **RC** (Release
   Coordination, `nxtaraspa.atlassian.net/jira/software/c/projects/RC`) que
   correspondan a este proyecto.
6. Detalle tabular de sprints del período.

## Fuera de alcance (decisiones tomadas en brainstorming)

- No hay endpoint único `/report`: el tab compone datos de los endpoints
  existentes (health, sprints, team, flow) + 2 endpoints nuevos, siguiendo el
  patrón actual de la app (un hook por sección).
- "Decisiones importantes" es 100% auto-generada desde métricas — no hay
  campo editable manual en esta iteración.
- Sin exportación a PDF/HTML en esta iteración (se puede agregar después
  reusando el mismo layout).

## Datos nuevos y su sync

### 1. Goal del sprint activo

`JiraSprint` (`artifacts/api-server/src/lib/jira.ts:571`) no incluye `goal`,
aunque la Agile API de Jira ya lo devuelve en el mismo payload que
`startDate`/`endDate`/`completeDate`. Cambio:

- Agregar `goal?: string` a `JiraSprint`.
- Persistir el campo donde hoy se persiste el resto del sprint (mismo cache
  que alimenta el tab Sprints).
- Endpoint nuevo `GET /api/projects/:id/sprint-goal` → `{ sprintName, goal } | null`
  (`null` si no hay sprint activo o el sprint no tiene goal configurado en Jira).

### 2. Releases del proyecto RC

Proyecto RC es compartido por las 5 células (Orvix Chile/OLP, Orvix Int. I,
Orvix Int. II, Xtrider, Docuvex) — sincronizarlo por proyecto sería 5x
redundante bajo el `concurrency=1` actual. Se sincroniza **una vez por ciclo
completo de sync**, no dentro del loop por proyecto.

**Tabla nueva** `release_epics` (mismo paquete `lib/db`, mismo patrón que
`jira-cache.ts`):

```ts
export const releaseEpicsTable = pgTable("release_epics", {
  id: serial("id").primaryKey(),
  issueKey: text("issue_key").notNull().unique(),  // "RC-22"
  summary: text("summary").notNull(),
  description: text("description"),
  status: text("status").notNull(),                // "Finalizada", "En Producción", etc.
  statusCategory: text("status_category").notNull(), // done | indeterminate | new
  assignee: text("assignee"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Sync: JQL `project = RC ORDER BY updated DESC`, reemplaza la tabla completa
en cada ciclo (mismo patrón simple que ya usa `portfolio-cache.ts` para datos
agregados de bajo volumen — RC tiene decenas de épicas, no miles).

**Tabla nueva** `project_release_keywords` (config por proyecto, mismo
patrón que `metric-targets.ts`):

```ts
export const projectReleaseKeywordsTable = pgTable("project_release_keywords", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),
  keyword: text("keyword").notNull(),  // "OLP", "Orvix Chile"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Seed inicial para OLP (proyecto 10003): `"OLP"`, `"Orvix Chile"` — editable
desde Admin, no hardcodeado en el código de negocio.

Endpoint nuevo `GET /api/projects/:id/release-readiness`:
1. Lee las keywords configuradas para `:id` en `project_release_keywords`.
2. Si no hay ninguna → `{ configured: false }`.
3. Si hay → filtra `release_epics` donde `summary` o `description` contiene
   alguna keyword (case-insensitive), devuelve `{ configured: true, epics: [...] }`
   ordenado por `updatedAt` desc, máximo 5.

Filtrado por texto en vez de JQL estructurado porque las épicas de RC no
tienen un campo de "proyecto vinculado" — es lo mismo que se validó a mano
hoy vía `text ~ "Orvix Chile"`.

### Admin UI

Nueva sub-sección en Admin (junto a Health) para gestionar
`project_release_keywords` por proyecto: agregar/quitar keyword, ver épicas
RC que matchean como preview antes de guardar.

## Backend: endpoints nuevos

| Endpoint | Método | Response |
|---|---|---|
| `/api/projects/:id/sprint-goal` | GET | `{ sprintName, goal } \| null` |
| `/api/projects/:id/release-readiness` | GET | `{ configured: false } \| { configured: true, epics: ReleaseEpic[] }` |
| `/api/admin/projects/:id/release-keywords` | GET/POST/DELETE | CRUD de keywords (solo `admin`, `requireSectionView`) |

RBAC: `sprint-goal` y `release-readiness` quedan como "baseline" (igual que
`metrics`/`analytics`), visibles a cualquier autenticado — son solo lectura,
mismo criterio que el resto del overview de proyecto. `release-keywords`
(escritura) requiere rol `admin`.

## "Decisiones importantes" — reglas auto-generadas

Lógica pura, testeable igual que las 22 pruebas existentes de métricas.
Reglas para v1 (todas comparan sprints **cerrados** consecutivos o cambios
de estado en Health):

1. **Caída de finalización**: si `finalización(sprint N) - finalización(sprint N-1) > 15 puntos porcentuales` → observación con ambos valores.
2. **Cruce de umbral en Health**: si una métrica (cycle time, lead time, CFR, bloqueados) pasó de "Bien"/"Advertencia" a "Crítico" (o viceversa) respecto al período anterior → observación.
3. **Nota de alcance del Flow Health Score**: fija, siempre presente (mismo texto que ya existe en el tooltip de Health) — no es "generada" sino contexto fijo necesario para no malinterpretar el score.

Cada regla es una función pura `(current: MetricsSnapshot, previous: MetricsSnapshot) => Insight | null`, testeada con fixtures de datos reales (como los sprints S111/S112 de esta sesión).

## Frontend

- Ruta `/projects/:id/report`, entrada de navegación junto a "Sprints".
- Composición de hooks: reusa los hooks existentes de Health/Sprints/Team/Flow
  para las secciones 1, 3 y 6; agrega `useSprintGoal` y `useReleaseReadiness`
  para las secciones 4 y 5; `useReportInsights` (nuevo, llama a un endpoint
  liviano o corre las reglas de la sección anterior client-side sobre datos
  ya obtenidos — a decidir en el plan de implementación, no cambia el diseño).
- Reusa componentes visuales existentes: cards de Health (`Necesita
  Atención`/`En Buen Estado`), tabla de Sprints, tabla de bloqueos de Flow —
  no se introduce un sistema visual nuevo.

### Casos borde

- Sin sprint activo o sin goal → sección de objetivo no se renderiza (sin
  placeholder).
- Sin keywords configuradas (`configured: false`) → sección de producción no
  se renderiza; si el usuario es `admin`, aviso sutil con link a Admin →
  Releases.
- Sin sprints cerrados en el período → sección de avances muestra solo el
  sprint activo, sin comparativas de "decisiones importantes" (esas reglas
  necesitan 2 sprints cerrados).

## Testing

- Unit tests de las 3 reglas de "decisiones importantes" con fixtures reales
  (S111/S112 de Olimpo entre otros casos límite: primer sprint del proyecto,
  proyecto sin sprints cerrados).
- Verificación manual en navegador del tab completo contra el proyecto
  10003, siguiendo la metodología ya establecida del proyecto (curl con
  token real antes de asumir bugs, captura de pantalla del resultado).
- `pnpm run typecheck` y rebuild de Docker antes de dar por cerrado.

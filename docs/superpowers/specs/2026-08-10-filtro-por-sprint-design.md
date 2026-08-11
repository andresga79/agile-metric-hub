# Reemplazar filtro por mes (1M/3M) por filtro por sprint en proyectos scrum

## Contexto

Todas las sub-páginas de un proyecto (`/projects/:id/...`) usan hoy un filtro de
período `"1m" | "3m"` para acotar la ventana de datos: resumen (Health), team,
analytics, issues, targets, blocked-KPI, kanban, sprints, QA rejected, report. El
tipo `Period` y el toggle de UI están **duplicados en 9 páginas frontend**
(`project-*.tsx`), y la validación (`VALID_PERIODS`/`isValidPeriod`) está
**duplicada en 4 archivos backend** (`metrics.ts`, `cfd.ts`, `analytics.ts`,
`qa-rejected.ts`); el resto de las rutas importa el helper compartido
`periodToDays()` de `jira.ts:1436`.

Para proyectos **scrum**, pensar en "último mes" no tiene sentido operativo: lo que
importa es el sprint. El disparador concreto es el gráfico de throughput trend en
`/projects/:id` (resumen/Health), que arma baldes de 7 días
(`buildWeeklyVelocity()` en `metrics.ts:194`) — el usuario quiere ver eso agrupado
por sprint en vez de por semana calendario.

Los proyectos **kanban** no tienen concepto de sprint y no se ven afectados por
este cambio.

## Alcance

- Reemplazar el filtro 1M/3M por un filtro de rango de sprints ("Últimos 2
  sprints" / "Últimos 6 sprints") en **todas** las sub-páginas de un proyecto
  **scrum**: resumen/Health, team, analytics, issues, targets, blocked-KPI, QA
  rejected, report.
- Kanban conserva el filtro 1M/3M sin cambios.
- La pestaña "Sprints" (`project-sprints.tsx` / `sprint-metrics.ts`) ya tiene su
  propia lógica de sprints (carryover, desglose) — no se toca; el nuevo filtro
  reutiliza el mismo patrón de fetch de sprints que ya usa esa ruta.
- Fuera de alcance: cambiar la granularidad interna de gráficos que son
  intrínsecamente temporales por naturaleza (CFD, forecast, SLA trend) — estos
  solo cambian el **límite de la ventana** (de "hace N días" a "desde el inicio
  del sprint N-ésimo hacia atrás"), no su bucketing interno día/semana.
- Excepción: `buildWeeklyVelocity()` en `metrics.ts` (el gráfico de throughput
  trend del resumen) sí cambia su bucketing — de baldes semanales a un balde por
  sprint — porque es el caso concreto que motivó este cambio.

## Modelo de selección

Rango de últimos N sprints **cerrados** (`state === "closed"`), análogo directo
al `period` actual: reemplaza `"1m"/"3m"` por, por ejemplo, `"2s"/"6s"`. Se
descartó un selector de sprint único porque obligaría a desacoplar "qué sprint
miro" de "cuántos sprints muestra el gráfico de tendencia", una decisión de UX
sin necesidad real hoy.

## Diseño

### 1. Helper compartido de ventana por sprint (backend)

Nueva función en `jira.ts`, junto a `getJiraSprints`:

```ts
async function getSprintWindow(
  projectId: string,
  sprintCount: number
): Promise<{ startDate: Date; sprintsIncluded: JiraSprint[] }>
```

Reutiliza el mismo patrón que ya existe en `sprint-metrics.ts:167-179`:
`getJiraSprints(projectId, 50)` → filtrar `state === "closed"` → ordenar por
fecha → `.slice(0, sprintCount)` → `.reverse()` (orden cronológico) →
`startDate` = `startDate` del primero de la lista.

**Caso borde — proyecto scrum sin sprints cerrados todavía:** si
`sprintsIncluded` queda vacío, el helper hace fallback a
`periodToDays("1m")` (mismo default que hoy) para no romper la página con una
ventana vacía. `sprintsIncluded` se devuelve vacío igual, así que el frontend
puede detectar el caso y mostrarlo (ej. "aún no hay sprints cerrados") en vez
de rotular el gráfico como si tuviera datos por sprint.

### 2. Tipo de ventana unificado (backend)

Cada ruta que hoy resuelve `periodToDays(period)` para acotar fechas pasa a
resolver un `startDate` a partir de:

- `boardType === "kanban"` → sigue usando `periodToDays(period)` tal cual hoy.
- `boardType === "scrum"` → usa `getSprintWindow(projectId, sprintCount)`.

Se centraliza la validación `VALID_PERIODS`/`isValidPeriod` (hoy duplicada en 4
archivos) en un único lugar compartido, ya que se está tocando de todos modos.
El formato del parámetro de ruta sigue siendo un string (`"1m"`, `"3m"`, `"2s"`,
`"6s"`) para no romper el patrón de rutas `:period` existente.

### 3. Bucketing por sprint en el gráfico de throughput trend

`buildWeeklyVelocity()` (metrics.ts:194) gana una rama para `isScrum`: en vez de
baldes de 7 días, arma un balde por cada sprint de `sprintsIncluded` —
`{ sprint: sprint.name, value: storyPoints }` — agregando los issues resueltos
dentro de las fechas de cada sprint. Kanban sigue con baldes semanales sin
cambios. El campo de salida pasa de `week` a algo genérico (`label`) para que el
frontend no necesite saber si es semana o sprint. Nota: `sprint.name` es texto
libre editable en Jira y no es una key confiable para des-duplicar o indexar —
solo se usa como label de display; si en algún momento se necesita identidad
estable, usar `sprint.id`.

### 4. Componente de filtro compartido (frontend)

Nuevo componente `<TimeWindowFilter>` que reemplaza el toggle duplicado en las 9
páginas. Recibe `boardType` (vía el proyecto ya cargado) y renderiza:

- kanban → botones "1M"/"3M" (igual que hoy).
- scrum → botones "Últimos 2"/"Últimos 6" (sprints).

Esto también resuelve de paso la duplicación del `type Period` local en cada
página — pasan a importar el tipo desde el componente compartido.

### 5. Regeneración de tipos

Como en el cambio previo de carryover, cualquier ajuste al contrato OpenAPI
(nombres de campo en la respuesta, ej. `week` → `label`) requiere correr el
codegen de Orval y verificar `pnpm run typecheck` en el workspace completo.

## Testing

- Tests de `metrics-logic.test.ts` para la nueva rama de `buildWeeklyVelocity`
  con `isScrum=true`: agrupación correcta por sprint, orden cronológico, sprint
  sin issues resueltos da `value: 0`.
- Test del helper `getSprintWindow`: filtra correctamente sprints no cerrados,
  respeta `sprintCount`, devuelve `startDate` correcto con 0/1/N sprints
  cerrados disponibles (caso borde: proyecto scrum nuevo sin sprints cerrados
  aún).
- Verificación manual con `curl` + token real en `/projects/10003` (scrum) y un
  proyecto kanban de control, siguiendo la metodología de `CLAUDE.md` (leer
  código → verificar con curl → listar hallazgos → aprobación → implementar →
  typecheck → rebuild → re-verificar → confirmar en navegador).

## Fuera de alcance / decisiones explícitas

- No se cambia la granularidad interna de CFD/forecast/SLA (solo el límite de
  ventana para scrum).
- Kanban no se toca.
- No se introduce un selector de sprint único; solo rango de últimos N.
- La pestaña Sprints existente no se modifica, solo se reutiliza su patrón de
  fetch.

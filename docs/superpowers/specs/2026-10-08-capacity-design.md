# Diseño: sección "Capacity" (planificación del próximo sprint)

Fecha: 2026-10-08 · Estado: propuesto, pendiente de revisión

## Objetivo

Responder, en la planning de un proyecto **Scrum**: **¿cuánto puede comprometer el equipo en el
próximo sprint, y está bien repartido entre las personas?**

Hoy los equipos comprometen ~el doble de lo que completan (últimos 6–7 sprints cerrados, en SP):

| Proyecto | Comprometido / sprint | Completado / sprint | % completado |
|---|---|---|---|
| Olimpo (OLP) | 76–142 | 19–96 (mediana ~51) | ~50 % |
| Olimpo Internacional (OLI) | 99–160 | 51–84 (mediana ~62) | ~50 % |
| Orvix Internacional I | 36–160 | 10–53 | ~45 % |

Éxito = el scrum master abre Capacity en la planning, ajusta ausencias en ~1 minuto, ve el rango
recomendado contra lo ya cargado y la carga por persona; con el tiempo el % completado sube.

### Decisiones tomadas

- Solo proyectos Scrum. Kanban no tiene "capacity de sprint" (posible versión aparte, fuera de alcance).
- Recomendación = **tasa histórica del equipo por día-persona × días-persona disponibles** (enfoque A).
- Dos unidades en paralelo: **story points** e **issues** (captura el trabajo sin estimar y es la
  unidad en la que se reparte trabajo a personas).
- Disponibilidad **combinada**: funciona sin cargar nada (histórico); se ajusta cargando ausencias y
  dedicación **por persona**.
- Solo **admin** edita; `member` ve en solo lectura. Sin cambios al modelo de roles.
- **Sin velocity individual ni rankings.** La capacidad de una persona deriva de la tasa del
  **equipo** × sus días disponibles; lo que se compara por persona es **carga** (asignado vs.
  capacidad), no rendimiento.
- Regla del equipo: **los sprints arrancan lunes y duran 10 días hábiles**.

## Qué muestra la pantalla

Nueva sección `capacity`, pestaña **"Capacity"** en la barra principal del proyecto, junto a
Sprints, visible solo en proyectos Scrum. Ruta: `/projects/:projectId/capacity`.

1. **Próximo sprint** — nombre y fechas, rango recomendado en SP y en issues, disponibilidad del
   equipo (%), lo comprometido hoy y dónde cae respecto al rango:
   - verde: comprometido ≤ máximo del rango
   - amarillo: hasta 15 % sobre el máximo
   - rojo: más de 15 % sobre el máximo
   Aviso de issues sin estimar ("6 issues sin estimar") cuando los hay.
2. **Equipo y carga** — una fila por persona: ausencia (días), dedicación (%), capacidad (SP ·
   issues), asignado en el sprint (SP · issues), carga (%). Fila **"Sin asignar"** con el trabajo
   del sprint sin responsable. Colores de carga: ≤ 85 % verde, 85–110 % amarillo, > 110 % rojo
   (constantes en código; mover a Admin → Health solo si hace falta). Para admin, ausencia y
   dedicación son editables, con botón "Guardar"; además puede agregar una persona sin issues
   (alguien que entra) o excluir a alguien (alguien que se fue).
3. **Histórico** — últimos 6 sprints cerrados: barras comprometido vs. completado, con toggle SP /
   issues, y el % completado de cada uno.

Textos en `es.json` y `en.json`.

## Datos y cálculo

### Próximo sprint

- El primer sprint **futuro** del tablero (por fecha de inicio); si no hay, el sprint **activo**.
- Duración: **10 días hábiles**, desde el lunes de inicio (regla del equipo; no se deduce de las
  fechas de Jira, que pueden faltar en un sprint futuro).
- `getJiraSprints` hoy pide `state=closed,active`: se agrega `future`, cacheado como el resto.

### Tasa del equipo (últimos 6 sprints cerrados)

Para cada sprint cerrado:

- `díasHábiles` = días lunes–viernes entre inicio y fin **reales** (el histórico no siempre cumple
  la regla: Orvix tuvo un sprint de 5 y otro de 15 días hábiles). Fechas normalizadas al día hábil:
  un inicio en domingo (OLI, 19-jul, probable zona horaria) cuenta desde el lunes.
- `díasPersona` = Σ por persona de `díasHábiles × dedicación − ausencia`:
  - si ese sprint se planificó en Capacity → la disponibilidad guardada;
  - si no → personas con issues asignados en el sprint, a tiempo completo y sin ausencias.
- `tasaSP = SP completados / díasPersona`; `tasaIssues = issues completados / díasPersona`.
- "Completado" = done al cierre del sprint (`wasIssueDoneAt`), mismo criterio que Sprints.
- Solo issues **del proyecto** (por clave), aunque el tablero traiga issues de otros. Es la causa
  probable de que Orvix Internacional I repita en julio los números de Olimpo Internacional
  (140/51 y 160/53); se confirma al implementar.

Resultado: P25 / P50 / P75 de `tasaSP` y de `tasaIssues`. Con **menos de 3 sprints cerrados**
no hay recomendación: se muestra el histórico disponible con "Faltan sprints para recomendar".

### Recomendación y carga

- `díasPersonaDisponibles = Σ (10 × dedicación − ausencia)` del equipo del próximo sprint.
- `disponibilidad % = díasPersonaDisponibles / (10 × personas del equipo)`.
- Rango recomendado = `díasPersonaDisponibles × [P25, P75]`, en SP y en issues (redondeado).
- Capacidad de una persona = `sus días disponibles × P50` (SP e issues).
- Asignado = issues del próximo sprint agrupados por responsable (SP e issues). Carga =
  asignado / capacidad. Persona con 0 días disponibles y trabajo asignado → rojo, sin dividir por 0.
- Issues sin story points: cuentan en issues, no en SP, y se informan como "sin estimar".

### Equipo por defecto

Personas con issues asignados en los últimos 6 sprints del proyecto, con ausencia 0 y dedicación
100 %, salvo lo que haya guardado admin para ese sprint.

## Persistencia

Tabla nueva `sprint_capacity`, creada al arrancar la API (`CREATE TABLE IF NOT EXISTS`, como las
demás tablas de runtime en `index.ts`) y declarada en el schema de Drizzle (`lib/db`):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | serial PK | |
| `project_id` | text not null | |
| `sprint_id` | text not null | id del sprint en Jira |
| `account_id` | text not null | `accountId` de Jira |
| `display_name` | text not null | nombre al momento de guardar |
| `absence_days` | numeric not null default 0 | 0 ≤ x ≤ días hábiles del sprint |
| `dedication_pct` | integer not null default 100 | 0–100 |
| `included` | boolean not null default true | false = excluida del equipo |
| `updated_at` | timestamptz not null default now() | |

Único: `(project_id, sprint_id, account_id)`. Guardar = upsert de todas las filas del sprint.

## API

En `lib/api-spec/openapi.yaml`, con cliente regenerado (no `fetch` suelto).

- `GET /api/projects/:projectId/capacity` — `requireSectionView("capacity")`. Responde:
  `sprint` (id, nombre, estado, inicio, fin, díasHábiles), `recommendation` (rango SP, rango
  issues, disponibilidad %), `committed` (SP, issues, sin estimar), `rate` (P25/P50/P75 por unidad,
  sprints usados), `team[]` (accountId, nombre, ausencia, dedicación, incluido, díasDisponibles,
  capacidad, asignado, carga %), `unassigned` (SP, issues), `history[]` (sprint, comprometido y
  completado en SP e issues, % completado), `warnings[]`. Proyecto Kanban → 400 con mensaje claro.
- `PUT /api/projects/:projectId/capacity/:sprintId` — solo admin (403 para member). Body:
  `[{ accountId, displayName, absenceDays, dedicationPct, included }]`, validado con Zod
  (ausencia entre 0 y los días hábiles del sprint; dedicación 0–100).

Código:

- `lib/capacity.ts` — funciones puras: `workingDays(start, end)`, `teamRate(sprints)`,
  `recommend(availableDays, rate)`, `personLoad(person, rate, assigned)`.
- `routes/capacity.ts` — los dos endpoints; lee sprints e issues del caché de Jira existente.

## Permisos

- `"capacity"` se agrega a `SECTIONS` (`routes/admin/constants.ts`), con los mismos defaults que
  el resto (admin y member ven; nadie edita salvo admin).
- **Bases existentes**: hoy los defaults solo se insertan si `role_permissions` está vacía
  (`routes/admin/roles.ts:14`), así que una sección nueva quedaría sin fila y daría 403 a members.
  Al arrancar se insertan los `(role, section)` faltantes de `DEFAULT_PERMISSIONS` con
  `ON CONFLICT DO NOTHING`, sin tocar los que ya existen.
- Frontend: `capacity` en `ORDERED_SECTIONS` y `PRIMARY_TAB_SECTIONS` (`project-tabs.tsx`) y en
  `getSectionLinks`, solo cuando `boardType === "scrum"`.

## Pruebas y verificación

Unitarias (vitest, `lib/__tests__/capacity.test.ts`):

- `workingDays`: 2 semanas = 10; inicio en domingo cuenta desde el lunes; sprint de 1 día;
  fechas con zona horaria.
- `teamRate`: P25/P50/P75 con sprints de 5 y 15 días hábiles; < 3 sprints → sin tasa; issues de
  otro proyecto en el tablero excluidos.
- `recommend`: disponibilidad al 50 % → rango a la mitad; dedicación 0 → capacidad 0.
- `personLoad`: % de carga; 0 días disponibles con asignado → rojo sin división por cero; issues
  sin responsable → "sin asignar".
- Validación del `PUT`: ausencia > días hábiles y dedicación fuera de 0–100 rechazadas.

Contra datos reales (metodología del proyecto):

- `curl` del GET para OLP, OLI y Orvix Internacional I: el histórico coincide con Sprints (SP e
  issues por sprint); el rango recomendado se recalcula a mano para un sprint.
- Orvix tras filtrar por proyecto: los sprints de julio ya no repiten los de OLI.
- Permisos: `member` → GET 200, PUT 403, pantalla en solo lectura; `admin` → guardar y recargar
  conserva los valores; base existente → `member` ve la pestaña sin tocar Admin.
- Proyecto Kanban: sin pestaña; GET → 400.
- `pnpm run typecheck`, tests, lint (≤ baseline), `pnpm install --frozen-lockfile` si cambian deps.
- Revisión visual en el navegador.

## Fuera de alcance

- Capacity para Kanban.
- Velocity o rendimiento individual; rankings de personas.
- Integración con calendarios / RR.HH. (Tempo, Google Calendar): la disponibilidad se carga en la app.
- Feriados: el sprint son siempre 10 días hábiles; un feriado se carga como ausencia de cada persona.
- Umbrales de carga configurables desde Admin.

## Addendum 2026-10-08 — solo cuentan los devs (lista persistente por proyecto)

Decisión del usuario tras ver el equipo de Olimpo (11 personas, de las cuales QA/PO y una cuenta
desactivada casi no estiman): **para capacity cuentan solo los devs**, y eso se marca **una vez por
proyecto**, no por sprint. Reemplaza "Equipo por defecto" y la columna "incluido" por sprint.

- **Lista por proyecto** (`capacity_roster`: proyecto, persona, nombre, `counts`, `manual`). Solo
  admin la edita. Una persona sin fila en la lista cuenta (default sí).
- **Aplica a todo, incluido el histórico**: en cada sprint cerrado, los días-persona suman solo a
  quienes cuentan. Lo completado incluye todo lo hecho en el sprint (también por quienes no cuentan,
  igual que hoy los issues sin asignar).
- **Días-persona de un sprint cerrado** = disponibilidad guardada de quienes cuentan **+** los
  asignados de ese sprint que cuentan y no estaban guardados, a tiempo completo (antes se ignoraban
  y la tasa salía inflada).
- **Equipo del próximo sprint** = quienes cuentan en la lista **+** asignados nuevos (sin fila en la
  lista) del último sprint cerrado, del activo y del próximo. Ya no la unión de los 6 sprints, que
  inflaba la disponibilidad respecto del histórico.
- **Disponibilidad por sprint** (ausencia, dedicación) sigue siendo por sprint. Dedicación 0 % cubre
  "no participa este sprint"; se elimina el "incluido" por sprint.
- **Personas manuales** (sin issues en Jira) viven en la lista con `manual = true`, se pueden quitar,
  y si aparece un asignado de Jira con el mismo nombre (sin distinguir mayúsculas ni espacios) se
  usa ese y la fila manual se ignora (no se cuenta dos veces).
- **Pantalla**: columna "Cuenta para capacity" (persistente). Quienes no cuentan se listan aparte con
  su trabajo asignado, sin capacidad.

Correcciones de la revisión final incluidas: sprints futuros sin caché y sin repetir un sprint ya
activo/cerrado, en el orden de Jira; la tabla no vuelve a valores viejos al guardar; el borrador se
reinicia al cambiar de proyecto.

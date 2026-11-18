# Evolución por sprint e informe anual 2026 — diseño

Fecha: 2026-11-18 · Estado: borrador para aprobación · Rama: `feat/evolution-2026`

## 1. Intención

Responder con números de la app (no de Rovo ni de planillas) **"¿cómo evolucionó el equipo en
2026?"**, sprint a sprint y por mes/trimestre, con una sola regla por número y una foto que no cambia
después de publicada. Primer equipo: **OLP (10003)**. Sirve además para mostrar el efecto de hitos
(p. ej. la llegada del scrum master en el Sprint 111) sin inflar la lectura.

Por qué ahora: el informe "Evolución del flujo P50/P85 Sprints 100–119" (Confluence) no cuadra con
Jira (sprint 103: dice 5 issues y CT 133 d; Jira da ~22 entregados y CT P50 ~10 d). La app no puede
hoy reproducir el año: corta en 90/150 días y recalcula todo en vivo, así que el pasado cambia.

## 2. Decisiones ya tomadas (usuario, 2026-11-18)

- **Año 2026** = lo **entregado entre el 1-ene y el 31-dic** (fecha de entrega). Por sprint: los
  sprints cerrados cuyo cierre cae en 2026 (OLP: 96 → último de diciembre).
- **Solo equipos Scrum**: OLP, OLI, ORINI. Se construye y verifica con **OLP**; OLI y ORINI usan el
  mismo motor después (sin trabajo extra salvo la verificación).
- **ORINI separado desde su inicio** (ago-2026). Los sprints que Jira comparte entre OLI y ORINI
  ("Tablero Sprint 42", "Tablero Sprint 1") se asignan a un solo proyecto (§4.4).
- **Número principal de cumplimiento = "% real cerrado"** (al cierre). El cumplimiento de Rovo
  ("Done hoy") se muestra como referencia: verificado que en OLP 96–117 da ~100 % en todos los
  sprints (lo arrastrado y terminado después se acredita a cada sprint), así que no muestra evolución.
- **Hitos**: el usuario llegó en el **Sprint 111**. Sus intervenciones (sprint de inicio a confirmar):
  foco en métricas, secciones del tablero orientadas a flujo, retrospectivas con acciones concretas.

## 3. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Tabla y gráficos por sprint desde el sprint 96 de OLP, y agregados por mes y trimestre.
- Hitos configurables y bloque "antes / después" de un hito con las mismas reglas.
- Foto **inmutable**: un sprint guardado no cambia aunque cambie Jira; el año se congela al 31-dic.
- Cuadrar con la pestaña Sprints para los sprints que ambas muestran (mismo % real, mismo Rovo).

**No-objetivos**
- Equipos Kanban (EXP) — fuera de esta versión.
- Cambiar reglas de cálculo existentes (se reutilizan, §4.1).
- Exportar a PDF/Confluence (la pestaña es la fuente; exportar puede venir después).

**Anti-objetivos**
- Que la evolución muestre un número distinto al de Sprints/Métricas para el mismo sprint.
- Atribuir causalidad: la UI dice "desde el hito", nunca "gracias a".
- Throughput bruto como argumento principal (el equipo pasó de ~6,6 a ~8 personas).
- Percentiles de muestras chicas presentados como dato firme.

## 4. Diseño

### 4.1 Reglas por número (todas existentes)

| Número | Regla | Fuente en código |
|---|---|---|
| % real cerrado (principal) | issues del alcance done **al cierre** / alcance | `computeSprintMetrics` → `closedAtSprintEnd*` |
| Cumplimiento Rovo (referencia) | done hoy / alcance, en SP | `completionRate` |
| Alcance, planificado, agregado, arrastrado | como Sprints | `computeSprintMetrics` |
| Entregados del sprint | entregados (sin cancelados ni limpiezas) con fecha de entrega en `[inicio, cierre)` del sprint | `getDeliveryDate`, `isNonDeliveryClosure`, ventanas de `buildSprintVelocityBuckets` |
| CT / LT: P50, P85, promedio | sobre los entregados del sprint | `getCycleTimeDays`, `getLeadTimeDays`, `lib/stats.ts` |
| Personas | asignados distintos entre los entregados | — |

Unidad principal: **issues**; SP como dato secundario. P85 = "—" con n < 5; P50 = "—" con n < 3.
Se muestra siempre **n de CT aparte** (en abril ~1/3 de lo entregado nunca pasó por "en curso").

### 4.2 Datos persistidos (nuevo)

Esquema con `CREATE TABLE IF NOT EXISTS` en `api-server/src/index.ts` + schema Drizzle en `lib/db`
(sin `drizzle-kit push`).

- **`evolution_sprints`** — una fila por sprint cerrado: `project_id`, `sprint_id`, `sprint_name`,
  `start_at`, `closed_at`, alcance/planificado/agregado/arrastrado (issues y SP), cerrados al cierre
  (issues y SP), % real, % Rovo, entregados (n, SP), personas, CT/LT P50/P85/promedio y n de CT,
  `formula_version`, `source` (`backfill` | `on_close`), `computed_at`, `frozen_at` (nullable).
  Clave única `(project_id, sprint_id)`.
- **`evolution_deliveries`** — una fila por issue entregado: `project_id`, `issue_key`, `issue_type`,
  `delivered_at`, `lead_days`, `cycle_days` (nullable), `story_points`, `assignee_id`, `sprint_id`
  (sprint en cuya ventana se entregó, nullable), `formula_version`, `frozen_at`. Única
  `(project_id, issue_key)`. Permite mes/trimestre y "antes/después" con percentiles agrupados reales
  (no promedios de percentiles). Volumen: ~1.200 filas/año en OLP, ~5.000 en OLI.
- **`project_milestones`** — `project_id`, `sprint_id` (o fecha), `label`, `kind`
  (`rol` | `practica` | `equipo` | `otro`), `note`, `created_by`, `created_at`.

`formula_version` arranca en `1`; cualquier cambio de regla que afecte estas columnas la sube y
obliga a recalcular las filas no congeladas.

### 4.3 Cómo se llenan

1. **Backfill único** (admin): `POST /api/admin/evolution/backfill { projectId, from: "2026-01-01" }`.
   - Sprints: `getJiraSprintsOrThrow` (todos los del board), cerrados con cierre ≥ `from`.
   - Alcance por sprint: `getSprintIssuesOrThrow(sprintId)` (sin tope de días) → `computeSprintMetrics`.
   - Entregados: rango absoluto por sprint con changelog. `getResolvedJiraIssuesInRange` hoy recibe
     "días atrás"; se agrega una variante por fechas absolutas (mismo JQL, mismo caché versionado).
   - **De a un sprint por vez** (concurrency 1, como el sync). Si un sprint falla, el backfill se
     detiene y lo informa: no escribe una fila vacía (regla de Composición, 84cdf52).
   - Idempotente: reescribe filas no congeladas; nunca toca filas con `frozen_at`.
2. **Al cerrar un sprint**: el sync diario detecta sprints cerrados sin fila y los calcula igual.
   Desde ahí la fila no se recalcula salvo cambio de `formula_version`.
3. **Congelar**: `POST /api/admin/evolution/freeze { projectId, until: "2026-12-31" }` marca
   `frozen_at` en sprints y entregas hasta esa fecha. El informe anual sale de filas congeladas.

**Limitación aceptada del backfill:** recalcula 2026 con las reglas de hoy. Lo limpiado o reabierto
después del cierre ya se ve así en Jira (p. ej. una limpieza posterior saca el issue del alcance —
comportamiento actual del código; `METRICS.md` dice lo contrario y se corrige en este trabajo). La
pestaña lo aclara con una nota "reconstruido el dd/mm con regla v1". Desde el primer cierre
posterior al deploy, cada sprint queda guardado tal como estaba al cerrar.

### 4.4 Sprints compartidos entre tableros

Un sprint pertenece al proyecto cuyo board lo originó (`originBoardId` del sprint en Jira). Un
sprint ajeno que aparece en otro board se ignora en ese proyecto. Orden siempre por `closed_at`,
nunca por nombre (OLI tiene un "Sprint 1" entre el 42 y el 44).

### 4.5 API de lectura

`GET /api/projects/:id/evolution?from=2026-01-01&to=2026-12-31&by=sprint|month|quarter`
→ `{ rows, milestones, comparison?, meta: { formulaVersion, reconstructedAt, frozenUntil } }`.
Con `compare=<milestoneId>`: bloque antes/después del hito sobre las mismas ventanas de longitud
comparable (por defecto: todos los sprints del año antes del hito vs desde el hito), con n de cada lado.
Mes/trimestre se calculan desde `evolution_deliveries` (entregados, CT/LT) y, para % real, como
promedio de los sprints que cierran en ese período (con n de sprints).
Permiso de lectura: `requireSectionView("sprints")` (mismo que Sprints).
Hitos: CRUD admin `GET/POST/DELETE /api/projects/:id/milestones`.

### 4.6 Pestaña "Evolución" (solo Scrum)

Ubicación: pestaña propia del proyecto, después de "Entrega y Planning". Período: 2026 (selector de
año preparado para 2027). Corte: Sprint | Mes | Trimestre.

1. **Antes / después** (si hay hito elegido): % real cerrado (media y variación en pp), CT P85, LT
   P50, entregados por persona por sprint — cada uno con n y la flecha de cambio; texto "desde el
   hito", sin lenguaje causal.
2. **% real cerrado por sprint** (barras) con la línea de Rovo como referencia punteada y tooltip
   "Rovo cuenta lo terminado después del cierre".
3. **Cycle time P50/P85** (líneas, eje logarítmico) y **Lead time P50/P85** (ídem), con línea de meta.
4. **Entregados por sprint** (barras, issues) con personas como dato del tooltip.
5. **Tabla**: sprint, fechas, alcance, planificado, agregado, arrastrado, cerrados al cierre, % real,
   % Rovo, entregados, SP, personas, CT n/P50/P85/prom, LT P50/P85/prom. Exportable a CSV.
6. Los **hitos** son líneas verticales en todos los gráficos, con su etiqueta.
7. Pie: "Fuente: Jira, regla v1, reconstruido el dd/mm; congelado hasta dd/mm" y estados de error
   explícitos ("No se pudo cargar"; nunca "Sin datos" por un error).

## 5. Verificación (criterio de aceptación)

- Typecheck, tests, lint (0 errores, warnings ≤ baseline) y build de Docker pasan.
- Tests unitarios: asignación de entrega a ventana de sprint, percentiles con n chico ("—"),
  agregado mensual/trimestral, comparación antes/después, sprint compartido ignorado, backfill que
  se detiene ante un sprint fallido, filas congeladas que no se reescriben.
- **OLP 113–118**: % real, % Rovo, alcance y CT P50 de la Evolución = los de la pestaña Sprints (curl).
- **OLP 96–118**: conteos de alcance y Done hoy = Jira vía conector Rovo (`sprint = <id>`), al menos
  en 3 sprints (uno de cada trimestre).
- Diferencias con el análisis preliminar del 2026-11-18 (scratchpad) explicadas: el preliminar no
  excluía limpiezas de backlog ni filtraba tipos de issue.
- Revisión visual en el navegador de la pestaña con OLP.

## 6. Fuera de alcance / después

- OLI y ORINI: correr backfill y verificar (mismo motor).
- Exportación del informe anual (PDF/Confluence) y comparación 2026 vs 2027.
- Kanban por mes.

## 7. Restricciones

Metodología de `CLAUDE.md` (curl con token real, aprobación, typecheck/tests/lint, rebuild,
re-verificación, commit con el porqué, push solo a pedido). Sin subir la concurrencia del sync ni el
tope global de 90 días: el backfill usa rangos acotados por sprint. Sin borrar tablas existentes
(`metric_snapshots` queda como está y no se reutiliza: sus valores vienen de reglas viejas).

## 8. Pendiente del usuario

- Sprint de inicio de cada intervención (foco en métricas, tablero orientado a flujo, retros con
  acciones concretas). Hasta entonces se carga solo el hito "Llegada SM — Sprint 111".

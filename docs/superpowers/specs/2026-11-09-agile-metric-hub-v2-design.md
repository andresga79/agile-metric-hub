# Agile Metric Hub v2 — diseño

Fecha: 2026-11-09 · Diseño visual de referencia: lienzo "Agile Metric Hub v2"
(https://claude.ai/artifact/Uv8pQjxsDmVihb8jcubw3r, pantallas `Portafolio`, `Main` = Equipo, `Mapa`).

## 1. Intención

La app actual tiene ~15 pantallas por proyecto y responde mal a las preguntas que de verdad
se hacen gerencia y los scrum masters. La v2 reorganiza todo en **3 vistas que responden
preguntas concretas**:

- **Portafolio** (gerencia): qué equipos cumplen, cuáles mejoran, cuáles requieren atención.
- **Equipo** (scrum master): ¿cumplimos lo que comprometemos?, ¿cuánto tarda el trabajo?,
  ¿dónde espera?, ¿qué tan estable es el sprint?, ¿cómo venimos?, ¿qué llevar a la planning?
- **Sprint** (retro): el informe de un sprint (KPIs contra el anterior, por persona, por tipo).

**Rovo es la fuente de verdad** para el número de cada sprint (el equipo lee sus sprints en
Rovo), pero la v2 quiere **marcar lo real**: lo que estaba terminado al cerrar el sprint.

## 2. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Implementar Portafolio, Equipo y Sprint con datos reales de Jira, fieles al lienzo en
  estructura y estilo (Nxtara Design System, tema oscuro).
- Que Portafolio y Equipo **saquen sus cifras del mismo cálculo**: el mismo equipo no puede
  mostrar números distintos en las dos vistas.
- Titular por sprint = número de Rovo; "% real cerrado" siempre visible al lado.

**No-objetivos**
- No reemplaza la app actual: **conviven**. La v2 vive en rutas `/v2/...`; las pantallas
  actuales (incluidas Forecast, Capacidad, Reporte por persona, QA rechazados, QA trabajo, Flow
  Health Score) siguen intactas en sus rutas.
- No cambia la regla "Completado = Done hoy" que usan las pantallas actuales (decisión del
  2026-11-06 en `CLAUDE.md`).
- Admin queda igual, salvo los umbrales nuevos de §5.

**Anti-objetivos** (sería un fracaso aunque funcione)
- Cifras que se contradicen entre vistas (como el 160 vs 146 issues y −34% vs −38% del lienzo).
- Tendencias, predictibilidad o recomendaciones calculadas sobre "Done hoy": como los sprints
  viejos tienden al 100%, cualquier comparación muestra una caída falsa.
- Que la v2 rompa o cambie el look de la app actual.
- Volver a tirar abajo la API por memoria (ver restricciones).

## 3. Restricciones

- **Memoria**: el cálculo por proyecto corre **serializado (concurrency=1)**, igual que
  `warmVisibleProjectsCache` / `calculateAndCachePortfolio` (fix de OOM, ver `CLAUDE.md`). El
  portafolio v2 recorre N proyectos × hasta 12 sprints: tiene que salir de caché, no calcularse
  en cada request.
- **Jira**: `getSprintIssues(sprintId)` trae el sprint completo (no lo recorta el cap de 90
  días). Respetar los gotchas de `CLAUDE.md`: changelog truncado (`completeTruncatedChangelogs`),
  paginación por clave, fecha de resolución desde el changelog, `CACHE_SCHEMA_VERSION` si cambia
  lo que se cachea.
- **Alcance de un sprint** = `sprintScopeIssues` (tipos permitidos en Admin, sin limpiezas de
  backlog), el mismo que usan la pestaña Sprints y el resumen de sprint.
- **RBAC**: mismos permisos que hoy (admin y member ven todo). Los endpoints v2 exigen
  `requireAuth`; el de equipo/sprint además `requireSectionView("sprints", ...)` como los actuales.
- **Stack existente**: Express 5 + Drizzle en la API; Vite + React + wouter + Tailwind +
  recharts + react-query en el dashboard; contrato OpenAPI en `lib/api-spec/openapi.yaml` con
  clientes generados (`lib/api-zod`, `lib/api-client-react`).
- **Proceso** (`CLAUDE.md`): typecheck, tests y lint a mano; verificar con `curl` contra datos
  reales; confirmar visualmente; no pushear sin pedido explícito.

## 4. Definiciones de métricas (decididas)

Para cada sprint del alcance:

| Concepto | Regla |
|---|---|
| **Comprometido** | SP del alcance del sprint (`totalStoryPoints`); conteo si no hay SP |
| **Número Rovo** (titular) | SP en Done **hoy** / comprometido (`completionRate`, regla actual) |
| **Real cerrado** | SP en Done **al cierre** (`wasIssueDoneAt`) / comprometido (`closedAtSprintEndRate`). Sprint activo: `null`, la UI muestra el avance actual |
| **No planificado** | SP que entraron después del fin del día 1 (`isAddedAfterPlanning`) / comprometido |
| **Arrastrado** | `carryoverStoryPoints` / comprometido |
| **Issues entregados** | issues en Done **al cierre**, desglosados por tipo (Historia / Técnico / Bug) |

Calculado **siempre sobre "real cerrado"** (nunca sobre el número de Rovo):
- **Cumplimiento del período** = promedio del % real cerrado de los sprints cerrados de la ventana.
- **Predictibilidad** = desvío estándar **muestral (n−1)** del % real cerrado entre sprints
  cerrados de la ventana (decisión del diseñador: con 3–12 sprints es la estimación estándar y
  la más conservadora; Olimpo 112–117 → 10,5 pp, "media"):
  alta ≤ 8 pp, media ≤ 12 pp, baja > 12 pp (umbrales configurables, §5). Se muestra con el
  rango min–max ("49% a 76%").
- **Tendencias** ("últimos vs anteriores") de cumplimiento, SP e issues cerrados, cycle time,
  lead time, no planificado y arrastrado.
- **Recomendación de planning** (ver §6.2).

Tiempos (sobre los issues entregados al cierre en los sprints de la ventana):
- **Tiempo de ciclo** = de iniciado a Done (`getCycleTimeDays`); se muestra **mediana** y P85.
  Por sprint, el gráfico usa el promedio. **Nombre en la UI: "Tiempo de ciclo"**, no
  "Tiempo de entrega" (en la app "lead time" es de creado a Done).
- **Lead time** = de creado a Done, mismo tratamiento.
- **Dónde espera el trabajo** = tiempo promedio por estado (`computeTimeInStatus`, de
  `routes/analytics.ts`), marcando cada estado como "esperando" o "trabajando". Entran los estados en curso
  (`indeterminate`) y también los de espera a mitad de flujo aunque Jira los ponga en To Do
  ("Ready for DEV", "Ready for QA"; `isWaitingStatus`); el backlog ("To Do", "Backlog",
  "Open") no. Decisión del usuario, 2026-11-09.

**Ventana**: selector 3 / 6 / 12 sprints cerrados (default 6), más el sprint activo si existe.
La comparación de tendencia es la mitad reciente contra la mitad anterior de la ventana
(6 → 3 vs 3; 12 → 6 vs 6); con 3 sprints, esos 3 contra los 3 anteriores.

## 5. "Requiere atención" (decidido)

Un equipo aparece en "Requiere atención" del Portafolio si:

- **Scrum**: cumplimiento real promedio de la ventana **< 50%**, **o** predictibilidad **baja**.
- **Kanban**: nunca (decisión del usuario, 2026-11-09). Los equipos Kanban se quedan en la
  tabla del Portafolio (volumen y tiempos) pero no se marcan: ni en la tarjeta, ni en el
  titular, ni con banner en su página de Equipo. *(Antes: throughput −30% o ciclo +30%.)*

Los cortes van a los **umbrales centralizados** (`DEFAULT_HEALTH_THRESHOLDS` →
`default_metric_thresholds`, editables en Admin → Health, con override por proyecto), como
manda la arquitectura del proyecto. Métricas nuevas (pares `goodValue` / `warningValue`):
- `sprintCompletionReal`: good 80, warning 50 (verde ≥ 80, ámbar ≥ 50, rojo < 50).
- `sprintPredictability` (desvío en pp): good 8, warning 12.
- ~~`kanbanThroughputDrop`, `kanbanCycleTimeRise`~~: retirados el 2026-11-09 (las filas ya
  sembradas en DB se ocultan en Admin → Health, no se borran).

El motivo se muestra junto al equipo ("cumplimiento 46%", "predictibilidad baja", "entregó 49%
menos").

## 6. Las vistas

Estructura y orden de secciones como el lienzo, con las correcciones de la revisión.

### 6.1 Portafolio — `/v2`
- Encabezado: "Gerencia · N equipos activos" (proyectos visibles para el usuario) y un titular
  generado de los datos ("Tres equipos mejoran su cumplimiento. XTRIDER AI entregó la mitad...").
- 3 tarjetas: cumplimiento real promedio (Scrum) con el desglose por equipo; equipos que mejoran
  (Scrum, tendencia de cumplimiento real positiva); requiere atención (§5) con nombre y motivo.
- Tabla de equipos (una fila por proyecto visible; cada fila lleva a su vista de Equipo):
  - ¿Cumple lo comprometido?: real promedio + cambio en pp + predictibilidad con rango. Kanban: "No aplica".
  - Tiempo de ciclo (mediana) + cambio %.
  - Issues entregados (al cierre, total de la ventana; Kanban: resueltos en 90 días) + cambio %.
  - Estabilidad: % no planificado y % arrastrado (promedio de la ventana). Kanban: "No aplica".
  - Lectura: una frase generada por reglas (motivo de atención, o la mejor señal del equipo).
- Pie con las definiciones (cumplimiento, predictibilidad, estabilidad).
- **Mismos números que la vista Equipo**: ambas leen el mismo cálculo por equipo.

### 6.2 Equipo — `/v2/projects/:projectId`
Scrum (como `Main.dc.html`):
- Encabezado: nombre, clave, "Sprints X a Y cerrados. Sprint Z en curso, cierra el ...",
  selector 3 / 6 / 12 sprints **funcional**.
- 4 respuestas rápidas: cumplimiento (real promedio, tendencia, "de cada 10 SP...",
  predictibilidad); tiempo de ciclo (mediana, tendencia **de la mediana**, P85); dónde se
  acumula (estado con más espera); último sprint cerrado (**número Rovo como titular y real
  cerrado al lado**, diferencia contra el promedio, no planificado del sprint).
- **Para la planning del próximo sprint** (sin doble conteo):
  - Capacidad total = promedio de SP (e issues) cerrados al cierre en los últimos 3 sprints.
  - Planificar = total × (1 − % no planificado promedio de esos 3); margen = total − planificar.
  - Texto: "Planificar ~X SP (N issues) y dejar ~Y SP de margen para lo que entra después".
  - Más las sugerencias del lienzo derivadas de datos (estado con más espera, lo que mejora).
- Cumplimiento por sprint: barras comprometido vs real cerrado, con el % Rovo también visible
  por sprint (etiqueta secundaria o tooltip).
- Issues entregados por sprint (al cierre, por tipo) contra el alcance del sprint. **La leyenda
  dice "Alcance del sprint", no "Planificados"** (incluye lo que entró después).
- Estabilidad del sprint: no planificado y arrastrado por sprint + tarjetas de tendencia.
- Tiempo de ciclo y lead time por sprint (gráfico) + mediana / P85 / % tiempo trabajando.
- Dónde espera el trabajo + alerta de issues en curso envejecidos (lógica de WIP aging de
  `analytics.ts`, umbral `wipAging`), con claves que linkean a Jira.
- Tendencia del equipo: tabla mitad reciente vs anterior (§4).

Kanban (decidido; EN y EXP hoy):
- Sin cumplimiento, planning ni estabilidad del sprint.
- Selector de ventana **30 / 90 / 180 días** (default 90) en vez de 3 / 6 / 12 sprints; la
  tendencia compara la ventana contra el período anterior de igual largo.
- 4 respuestas rápidas: issues entregados en la ventana + cambio vs período anterior; tiempo de
  ciclo (mediana, cambio, P85); dónde se acumula el trabajo; issues en curso envejecidos.
- Gráficos de issues entregados (por tipo) y de tiempo de ciclo / lead time **por semana**.
- Dónde espera el trabajo y tabla de tendencia, como en Scrum.

### 6.3 Sprint — `/v2/projects/:projectId/sprints/:sprintId`
- Reusa `GET /api/projects/:id/sprint-summary/:sprintId` (`lib/sprint-summary.ts`) con el estilo
  nuevo: KPIs contra el sprint anterior, SP por integrante, rendimiento individual, distribución
  por tipo con claves pendientes.
- KPI de cumplimiento: **número Rovo como titular y real cerrado al lado** (el endpoint suma el
  dato "Done hoy" que hoy no devuelve).
- Selector de sprint (default: último cerrado). Se llega desde las barras de sprint de la vista
  Equipo y desde la navegación.

### Navegación y estilo
- Header v2: logo, "Portafolio" y "Equipos" (selector de equipo), indicador de última
  sincronización, y un link "Versión actual" de vuelta a la app de siempre.
- En la app actual: un link discreto "Probar v2" en el header.
- Estilo Nxtara **solo dentro de `/v2`**: fondo `#1A1F2C`, magenta `rgb(236,17,123)`,
  MuseoModerno (títulos) + Jost (texto), tarjetas glass; tokens del lienzo
  (`project/ds/nxtara/tokens.json`, `glass/nxt-tokens.css`). Iconos: lucide (ya instalado) en vez
  de Material Symbols. Números con coma decimal (es-CL).
- Accesible como el lienzo: botones reales, tablas con `th`, contraste ≥ 4.5:1.
- **Solo español** (decidido): la v2 no usa i18next ni `en.json`; los textos van en español
  directo y los números con formato es-CL, sin depender del idioma elegido en la app actual.

## 7. Backend

Endpoints nuevos (en `openapi.yaml`, clientes regenerados):
- `GET /api/v2/projects/:projectId/team?sprints=3|6|12` (Scrum) / `?days=30|90|180` (Kanban)
  → todo lo de §6.2: sprints de la
  ventana con ambas reglas, agregados, tendencias, predictibilidad, planning, tiempos,
  tiempo por estado, WIP envejecido, estado de atención.
- `GET /api/v2/portfolio?sprints=3|6|12` → una fila por proyecto visible, **armada del mismo
  resultado por equipo** (no de `portfolio-cache.ts`, que cuenta resueltos en 90 días).
- Sprint: se extiende `sprint-summary` con el número "Done hoy".

El cálculo por equipo se separa en funciones puras (ventana, tendencia por mitades,
predictibilidad, planning, reglas de atención) con tests en vitest, y se cachea por
(proyecto, ventana), calentado durante el sync **de a un proyecto por vez**.

## 8. Verificación

- Tests de la lógica pura (casos del lienzo: Olimpo 112–117 → promedio 61,8%, +10,2 pp,
  rango 49–76%, no planificado 24% → 39%).
- `curl` contra datos reales: Tablero Sprint 116 = 85/112 SP (75,9%) real cerrado; Sprint 117 =
  Rovo 86,9% (86/99 SP), real 53,5% (53/99 SP).
- Mismo equipo, mismos números en Portafolio y Equipo.
- Revisión visual en el navegador (Portafolio, Equipo Scrum, Equipo Kanban, Sprint) y en
  ancho de teléfono.

## 9. Decisiones menores tomadas por el diseñador (revisables)
- Promedios de cumplimiento = media simple de los % por sprint (no ponderada por SP); el promedio
  del portafolio = media simple entre equipos Scrum.
- Las tendencias de tiempo de ciclo (Equipo, Portafolio y regla Kanban de §5) usan la **mediana**.
- Portafolio y Equipo muestran exactamente los mismos deltas (mitad vs mitad).
- Tipos para el gráfico de issues: Historia = Story, Bug = Bug, Técnico = todo lo demás.
- Tableros "simple" se tratan como Kanban.

## 10. Lo que queda a criterio del builder
- Forma interna del caché y TTL (atado al ciclo de sync).
- Componentes y estructura de archivos del frontend; reusar recharts o SVG propio.
- Textos de "lectura" y del titular del portafolio (reglas simples, sin inventar datos).
- Cómo se clasifica cada estado como "esperando" o "trabajando" (categoría de Jira o mapeo existente).

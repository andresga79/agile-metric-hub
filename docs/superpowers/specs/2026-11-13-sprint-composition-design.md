# Composición del sprint por tipo de trabajo — diseño

Fecha: 2026-11-13 · Estado: enfoque aprobado; revisado por builder check; aprobado por el usuario 2026-11-13

## 1. Intención

El scrum master quiere saber **de qué está hecho un sprint normal del equipo**: qué % es Historia de
usuario, qué % hotfix, tareas, spikes y deuda técnica, y cómo se comporta cada tipo (cuánto se cierra,
cuánto tarda, cuánto entra a mitad de sprint). Con eso:

- en la retro / revisión: ver si la mezcla es estable o si el hotfix se está comiendo el sprint;
- al planificar capacidad: repartir el compromiso recomendado por tipo y dejar margen para lo que
  entra a mitad (los equipos trabajan Scrumban, ver `2026-11-12-app-consolidation-design.md` §2).

A cambio se **saca la sección "Resumen de sprint"** (estilo Rovo, un sprint por vez) de la pestaña
Sprints: el usuario no la quiere ahí y su bloque "4 · Por tipo" queda superado por esta vista.

## 2. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Tarjeta "Composición del sprint" en Entrega y Planning → Sprints, en el lugar del Resumen de sprint,
  con las cadencias del sitio: **Últimos 2 / Últimos 6** sprints cerrados.
- Línea "Mezcla esperada" en Entrega y Planning → Capacidad, debajo del compromiso recomendado.

**No-objetivos**
- No cambiar el filtro 1M/3M del encabezado de la pestaña Sprints (está desalineado con las cadencias
  2/6, pero es otro cambio; la tarjeta trae su propio selector).
- No crear un tipo "Hotfix" en Jira ni reglas nuevas de clasificación (ver §4.1).
- No tocar Kanban: la tarjeta es solo para tableros Scrum (la pestaña Sprints ya es solo Scrum).

**Anti-objetivos** (sería un fracaso aunque funcione)
- Que la tarjeta cuente issues distintos a los de la tabla de Sprints de la misma pantalla (mismo
  alcance de issues; ver §4.2 para la única diferencia, issues de otros proyectos).
- Que el cycle time por tipo no cuadre con el de Métricas para la misma ventana (misma regla de
  "por fecha de entrega").
- Incluir Test / Test Execution / Test Plan / Epic en la composición (no son trabajo de entrega).

## 3. Enfoques considerados

| Enfoque | Trade-off | |
|---|---|---|
| **A. Tarjeta en Sprints + línea en Capacidad** | Cada lugar responde una pregunta: mirar hacia atrás (Sprints) y repartir lo que se compromete (Capacidad). Dos superficies, un solo cálculo. | **Elegido por el usuario** |
| B. Sub-pestaña nueva "Composición" en Entrega y Planning | Más espacio, pero suma una vista contra la consolidación a 6 vistas. | Descartado |
| C. Solo en Capacidad | Se pierde la mirada hacia atrás para la retro. | Descartado |

## 4. Lo decidido

### 4.1 Categorías

Se agrupan los tipos con `getEffectiveIssueType` / `mapIssueType` (`lib/jira.ts`), que ya existe:

| Categoría en pantalla | Tipo interno | Tipos de Jira que caen ahí |
|---|---|---|
| Historia (HU) | Story | Historia |
| Hotfix (Error) | Bug | Error, Problema |
| Tarea | Task | Tarea, Tarea Técnica |
| Spike | Spike | Spike |
| Deuda técnica | Tech Debt | Deuda Técnica |

- **Hotfix = Error** lo dijo el usuario. Que "Problema" (18 issues, solo OLP) también cuente como
  hotfix y que Tarea + Tarea Técnica vayan juntas es propuesta mía, sin objeción del usuario.
- **Supuesto abierto:** que todo Error sea hotfix (y no también fallas encontradas por QA dentro del
  sprint). El usuario no lo respondió explícitamente. La columna "Entró a mitad" deja ver cuánto del
  Error fue no planificado, así que la vista sirve en cualquiera de los dos casos.

### 4.2 Población

- **Alcance de issues = `sprintScopeIssues`** (`routes/sprint-metrics.ts`): tipos habilitados en
  Admin menos cierres que no son entrega (`isNonDeliveryClosure`), **más** el filtro por clave de
  proyecto que ya aplica Capacidad (`key.startsWith(projectKey + "-")`, `routes/capacity.ts`
  `loadSprintIssues`): un issue de otro proyecto que el filtro del tablero arrastra no es composición
  de este equipo. *(Decisión mía.)* Si un tipo se deshabilita en Admin, desaparece de la
  composición. Verificado en la DB local 2026-11-13: habilitados Story, Task, Bug, Spike, Tech Debt
  (el default de código es solo Story/Task/Bug, así que en una DB nueva Spike y Deuda no aparecen
  hasta habilitarlos).
- **Ventana:** últimos 2 o 6 sprints **cerrados** del tablero. El sprint activo no entra (sus números
  todavía se mueven). Default de la tarjeta: Últimos 6.
- **Membresía por sprint:** un issue cuenta en la composición de cada sprint en que estuvo (es lo que
  el equipo tuvo en el tablero ese sprint). El arrastre se ve, no se esconde.

### 4.3 Métricas por categoría (tarjeta en Sprints)

| Columna | Definición |
|---|---|
| % issues | issues de la categoría / issues totales, sumando los sprints de la ventana |
| Issues/sprint | promedio por sprint cerrado de la ventana |
| SP/sprint | promedio de story points por sprint (referencia; la base de planificación son issues) |
| % real cerrado | **por issues**: issues de la categoría Done al cierre de su sprint (`wasIssueDoneAt`) / issues de la categoría, sumados sobre todos los sprints de la ventana (pooled, no promedio de tasas). *(Decisión mía: issues son la base de planificación. La columna "% Real cerrado" de la tabla usa SP cuando hay; el total de la tarjeta puede diferir de ella por eso, y se aclara en una nota bajo la tabla.)* |
| Cycle P50 / P85 | cycle time de los issues de la categoría **entregados dentro de la ventana de algún sprint cerrado** (`[inicio, cierre)` de cada sprint, sin los huecos entre sprints) — misma población que `sprintDeliveryTimes.closedPooled` / Métricas. *(Decisión mía.)* |
| Entró a mitad | % de los issues de la categoría que entraron después de la planificación (`isAddedAfterPlanning`, mismo corte por zona horaria que ya usa la tabla) |

Debajo de la tabla: **barra apilada por sprint** (un sprint por barra, segmentos por categoría, en %)
para ver si la mezcla es estable entre sprints.

Boceto (números de ejemplo):

```
Composición del sprint                        [Últimos 2 | Últimos 6]
Promedio por sprint · 6 sprints cerrados (112–117)

Tipo           % issues  Issues/sprint  SP/sprint  % real cerrado  Cycle P50/P85  Entró a mitad
Historia          58 %       11.5          34          82 %          6d / 11d          8 %
Hotfix (Error)    24 %        4.8           6          91 %          2d /  5d         71 %
Tarea             12 %        2.3           5          88 %          3d /  7d         20 %
Spike              4 %        0.8           2          75 %          4d /  8d          0 %
Deuda técnica      2 %        0.3           1          50 %          9d / 14d          0 %

[barra apilada por sprint 112 … 117]
```

Una categoría sin issues en la ventana no se muestra. P50/P85 con menos de 3 entregados → "—".

### 4.4 Mezcla esperada (Capacidad)

Debajo del compromiso recomendado del próximo/activo sprint:

```
Mezcla esperada (últimos 6 sprints): ~12 HU · ~5 hotfix · ~2 tareas · ~1 spike
~3–4 hotfix suelen entrar a mitad de sprint: conviene dejar ese margen libre
```

- Reparto = **punto medio** del rango recomendado en issues (`recommend()` devuelve `[p25, p75]`,
  `lib/capacity.ts`) × % issues de cada categoría (Últimos 6), redondeado. *(Decisión mía: un número
  por tipo se lee mejor que un rango por tipo.)*
- Línea de margen = promedio por sprint de issues Hotfix que entraron a mitad. Solo se muestra si
  es ≥ 1.
- Si no hay recomendado (menos de `MIN_SPRINTS_FOR_RATE` sprints), la línea no aparece.

### 4.5 Quitar el Resumen de sprint

- Sacar `<SprintSummarySection>` de `pages/project-sprints.tsx` y borrar
  `components/sprint-summary-section.tsx` y sus claves `page.sprintSummary.*` de `es.json`/`en.json`
  si no las usa nadie más.
- Borrar también el backend que queda sin uso: `routes/sprint-summary.ts` (y su registro en
  `routes/index.ts`), `lib/sprint-summary.ts`, `lib/__tests__/sprint-summary.test.ts` y la operación en
  `lib/api-spec/openapi.yaml` (regenerar cliente). Verificado: nada más lo usa (`report-insights.ts`
  solo comparte un nombre de tipo propio). *(Decisión mía: el usuario dijo "ocultar o eliminar"; queda
  en git si se quiere volver.)* Antes de borrar, mover a la lib nueva lo que sirva (p. ej. helpers de
  tipo/estimación).

## 5. Restricciones

- Fetch de Jira, dos fuentes (como ya hace la pestaña Sprints):
  - **por sprint** (`getSprintIssues` de cada sprint cerrado de la ventana): composición, % real
    cerrado, entró a mitad;
  - **por fecha** (`getJiraIssuesForWindow` con `2s`/`6s`, puede pasar de 90 días): solo cycle time,
    igual que `sprintDeliveryTimes`. No subir el cap global.
- Un solo cálculo para Sprints y Capacidad (función pura testeable en `lib/`), así los dos lugares
  muestran el mismo %.
- Contrato por OpenAPI (`lib/api-spec/openapi.yaml` → orval) como el resto de endpoints.
- Lectura gateada como la pestaña Sprints (`requireSectionView("sprints", ...)`).
- Textos en español en `es.json` (y su par en `en.json`).
- `pnpm run typecheck`, tests de api-server y lint (sin subir el baseline de warnings) antes de
  commitear; verificar con `curl` contra datos reales y en el navegador.

## 6. Queda a criterio del builder

- Forma exacta del endpoint (uno nuevo `GET /projects/:id/sprint-composition/:window` o un campo
  más en una respuesta existente) y dónde lo consume Capacidad.
- Colores de las categorías en la barra apilada (consistentes con los del resto del sitio si existen).
- Caché: si conviene cachear el resultado como otras vistas pesadas.

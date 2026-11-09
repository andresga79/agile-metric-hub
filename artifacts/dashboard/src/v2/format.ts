const MINUS = "−";
const NO_PRIOR = "sin dato previo";
const NO_VALUE = "—";

const nf = (decimals: number) =>
  new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: decimals });

const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Valor plano con coma decimal; null -> "—". */
export function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (!isNum(n)) return NO_VALUE;
  const s = nf(decimals).format(Math.abs(n));
  return n < 0 && Number(s.replace(/\./g, "").replace(",", ".")) !== 0 ? `${MINUS}${s}` : s;
}

/** "61,8%"; null -> "—". */
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  return isNum(n) ? `${fmtNum(n, decimals)}%` : NO_VALUE;
}

/** Delta en puntos porcentuales: "+10,2 pp" / "−2 pp"; null -> "sin dato previo". */
export function fmtPp(n: number | null | undefined): string {
  if (!isNum(n)) return NO_PRIOR;
  const body = nf(1).format(Math.abs(n));
  if (Number(body.replace(",", ".")) === 0) return "0 pp";
  return `${n > 0 ? "+" : MINUS}${body} pp`;
}

/** Variación relativa: "▲ 28%" / "▼ 34%"; null -> "sin dato previo". */
export function fmtDeltaPct(n: number | null | undefined): string {
  if (!isNum(n)) return NO_PRIOR;
  const body = nf(0).format(Math.abs(n));
  if (body === "0") return "0%";
  return `${n > 0 ? "▲" : "▼"} ${body}%`;
}

/** "8 días" / "6,5 días" / "1 día"; null -> "—". */
export function fmtDays(n: number | null | undefined): string {
  if (!isNum(n)) return NO_VALUE;
  const body = fmtNum(n, 1);
  return `${body} ${Math.abs(n) === 1 ? "día" : "días"}`;
}

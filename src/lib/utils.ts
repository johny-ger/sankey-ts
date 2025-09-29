/**
 * Утилиты без зависимостей.
 */

/** Простой генератор случайных id с префиксом */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Ограничение значения диапазоном [a, b] */
export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/** Безопасное получение числа из строки/неизвестного типа с дефолтом */
export function toNumber(maybe: unknown, fallback = 0): number {
  const n = Number(maybe);
  return Number.isFinite(n) ? n : fallback;
}

/** Хелпер для создания SVG-элементов */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

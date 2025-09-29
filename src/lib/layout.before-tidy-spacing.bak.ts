import type { SankeyData, SankeyOptions } from './types';

type Pos = { x: number; y: number; width: number; height: number };
interface LayoutResult { nodes: Map<string, Pos>; }

/**
 * Слоёный лэйаут с аккуратной горизонталью:
 * - равномерная ширина колонок (занимаем всю ширину);
 * - longest-path для слоёв + принудительно переносим "синки" (out=0) вправо;
 * - поддержка fixedLayers и pinRightIds;
 * - упорядочивание внутри слоя по барицентру (минимизирует пересечения);
 * - высота узла пропорциональна (in+out) * linkWidthScale.
 */
export function autoLayout(
  data: SankeyData,
  opts: Pick<Required<SankeyOptions>,
    'width'|'height'|'padding'|'nodeGap'|'colGap'|'linkWidthScale'
  > & Partial<Pick<Required<SankeyOptions>, 'fixedLayers'|'pinRightIds'>>
): LayoutResult {
  const { width, height, padding, nodeGap, linkWidthScale } = opts;
  const fixedLayers = opts.fixedLayers ?? {};
  const pinRight = new Set(opts.pinRightIds ?? []);

  const nodeIds = data.nodes.map(n => n.id);
  const N = nodeIds.length;
  const id2idx = new Map<string, number>(nodeIds.map((id, i) => [id, i]));

  // Суммы потоков
  const inSum = new Array<number>(N).fill(0);
  const outSum = new Array<number>(N).fill(0);

  // Соседи с весами (для барицентра)
  const preds = new Map<string, Array<{ id: string; w: number }>>();
  const succs = new Map<string, Array<{ id: string; w: number }>>();
  for (const id of nodeIds) { preds.set(id, []); succs.set(id, []); }

  for (const l of data.links) {
    const si = id2idx.get(l.source); const ti = id2idx.get(l.target);
    if (si == null || ti == null) continue;
    outSum[si] += l.value;
    inSum[ti] += l.value;
    preds.get(l.target)!.push({ id: l.source, w: l.value });
    succs.get(l.source)!.push({ id: l.target, w: l.value });
  }

  // --------- СЛОИ ----------
  const layer = new Array<number>(N).fill(0);
  // Источники в 0
  for (let i = 0; i < N; i++) if (inSum[i] === 0 && outSum[i] > 0) layer[i] = 0;

  // Longest-path (ограниченные итерации)
  const ITER = 3 * Math.max(10, N);
  for (let it = 0; it < ITER; it++) {
    let changed = false;
    for (const l of data.links) {
      const si = id2idx.get(l.source)!;
      const ti = id2idx.get(l.target)!;
      const need = layer[si] + 1;
      if (layer[ti] < need) { layer[ti] = need; changed = true; }
    }
    if (!changed) break;
  }

  // fixedLayers переопределяют
  for (const [id, lyr] of Object.entries(fixedLayers)) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = Math.max(0, Math.floor(lyr));
  }

  // Нормализация от 0
  const minL = Math.min(...layer);
  for (let i = 0; i < N; i++) layer[i] -= minL;

  // Синки вправо (+ потом pinRight)
  let maxL = Math.max(0, ...layer);
  for (let i = 0; i < N; i++) {
    if (outSum[i] === 0 && inSum[i] > 0) layer[i] = maxL + 1;
  }
  maxL = Math.max(...layer);
  for (const id of pinRight) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = maxL + 1;
  }
  maxL = Math.max(...layer);

  // Слои как списки id
  const layers: string[][] = Array.from({ length: maxL + 1 }, () => []);
  nodeIds.forEach((id, i) => layers[layer[i]].push(id));

  // --------- Геометрия колонок ----------
  const nodeWidth = 12;
  const innerW = Math.max(1, width - padding * 2);
  const totalCols = Math.max(1, layers.length);
  // РАВНОМЕРНОЕ распределение по ширине:
  const colStep = totalCols > 1 ? (innerW - nodeWidth) / (totalCols - 1) : 0;
  const colX0 = padding;

  // Предварительные размеры (высота по весу)
  const heightOf = (id: string) => {
    const i = id2idx.get(id)!;
    return Math.max(16, (inSum[i] + outSum[i]) * (linkWidthScale * 0.6));
  };

  // Раскладка слоя по текущему порядку -> позиции + центры
  const layoutLayer = (ids: string[], x: number, centers: Map<string, number>) => {
    const heights = ids.map(heightOf);
    const totalH = heights.reduce((a, b) => a + b, 0);
    const freeH = Math.max(0, height - padding * 2 - (ids.length - 1) * nodeGap);
    const k = totalH > 0 ? Math.min(1, freeH / totalH) : 1;

    let y = padding + (freeH - totalH * k) / 2;
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      const h = heights[j] * k;
      centers.set(id, y + h / 2);
      y += h + nodeGap;
    }
  };

  // Барицентр для id по соседям (pred или succ)
  const bary = (id: string, neighborList: Array<{ id: string; w: number }>, centers: Map<string, number>) => {
    let sw = 0, s = 0;
    for (const nb of neighborList) {
      const c = centers.get(nb.id);
      if (c == null) continue;
      sw += nb.w; s += nb.w * c;
    }
    return sw > 0 ? s / sw : centers.get(id) ?? 0;
  };

  // --------- Итерационное улучшение порядка (barycenter) ----------
  // Начальные центры: по текущему порядку в слоях
  const centers = new Map<string, number>();
  for (let li = 0; li < layers.length; li++) {
    layoutLayer(layers[li], colX0 + colStep * li, centers);
  }

  const stableSortBy = <T,>(arr: T[], key: (x: T) => number) => {
    return arr
      .map((v, i) => ({ v, i, k: key(v) }))
      .sort((a, b) => (a.k - b.k) || (a.i - b.i))
      .map(o => o.v);
  };

  const ITER_ORDER = 4;
  for (let it = 0; it < ITER_ORDER; it++) {
    // left->right: слои 1..L по предкам
    for (let li = 1; li < layers.length; li++) {
      const ids = layers[li];
      layers[li] = stableSortBy(ids, id => bary(id, preds.get(id)!, centers));
      layoutLayer(layers[li], colX0 + colStep * li, centers);
    }
    // right->left: слои L-1..0 по потомкам
    for (let li = layers.length - 2; li >= 0; li--) {
      const ids = layers[li];
      layers[li] = stableSortBy(ids, id => bary(id, succs.get(id)!, centers));
      layoutLayer(layers[li], colX0 + colStep * li, centers);
    }
  }

  // Финальные позиции
  const pos = new Map<string, Pos>();
  for (let li = 0; li < layers.length; li++) {
    const ids = layers[li];
    const x = colX0 + colStep * li;
    const heights = ids.map(heightOf);
    const totalH = heights.reduce((a, b) => a + b, 0);
    const freeH = Math.max(0, height - padding * 2 - (ids.length - 1) * nodeGap);
    const k = totalH > 0 ? Math.min(1, freeH / totalH) : 1;

    let y = padding + (freeH - totalH * k) / 2;
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      const h = heights[j] * k;
      pos.set(id, { x, y, width: nodeWidth, height: h });
      y += h + nodeGap;
    }
  }

  // Уважаем ручные фиксации (drag)
  for (const n of data.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    if (typeof n.x === 'number') p.x = n.x;
    if (typeof n.y === 'number') p.y = n.y;
    if (typeof n.width === 'number') p.width = n.width;
    if (typeof n.height === 'number') p.height = n.height;
  }

  return { nodes: pos };
}

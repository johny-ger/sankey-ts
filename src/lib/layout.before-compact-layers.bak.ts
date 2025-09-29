import type { SankeyData, SankeyOptions } from './types';

type Pos = { x: number; y: number; width: number; height: number };
interface LayoutResult { nodes: Map<string, Pos>; }

/**
 * Слоёный лэйаут:
 *  - равномерно распределяем колонки по ширине;
 *  - longest-path для слоёв + переносим синки (out=0) вправо + pinRightIds;
 *  - барицентрическая сортировка внутри слоёв для уменьшения пересечений;
 *  - аккуратная вертикальная раскладка: поддержка minNodeHeight, адаптивные интервалы.
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

  // --- веса входов/выходов и соседства ---
  const inSum = new Array<number>(N).fill(0);
  const outSum = new Array<number>(N).fill(0);
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

  // DEBUG: входы/выходы по узлам
  const __dbgEnabled = true;
  if (__dbgEnabled) {
    // узлы в порядке nodeIds
    const dbgIO = nodeIds.map((id, i) => ({ id, in: inSum[i], out: outSum[i] }));
    // показываем коротко
    // eslint-disable-next-line no-console
    console.table(dbgIO);
  }

  // --- слои (longest-path) ---
  const layer = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) if (inSum[i] === 0 && outSum[i] > 0) layer[i] = 0;

  const ITER_LAYERS = 3 * Math.max(10, N);
  for (let it = 0; it < ITER_LAYERS; it++) {
    let changed = false;
    for (const l of data.links) {
      const si = id2idx.get(l.source)!;
      const ti = id2idx.get(l.target)!;
      const need = layer[si] + 1;
      if (layer[ti] < need) { layer[ti] = need; changed = true; }
    }
    if (!changed) break;
  }

  // fixedLayers сильнее
  for (const [id, lyr] of Object.entries(fixedLayers)) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = Math.max(0, Math.floor(lyr));
  }

  // нормализация от нуля
  const minL = Math.min(...layer);
  for (let i = 0; i < N; i++) layer[i] -= minL;

  // синки вправо
  let maxL = Math.max(0, ...layer);
  for (let i = 0; i < N; i++) {
    if (outSum[i] === 0 && inSum[i] > 0) layer[i] = maxL + 1;
  }
  maxL = Math.max(...layer);

  // pinRightIds ещё правее
  for (const id of pinRight) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = maxL + 1;
  }
  maxL = Math.max(...layer);

  // DEBUG: итоговые слои по узлам
  if (__dbgEnabled) {
    const dbgLayers = nodeIds.map((id, i) => ({ id, layer: layer[i] }));
    // eslint-disable-next-line no-console
    console.table(dbgLayers);
    // eslint-disable-next-line no-console
    console.log('layersCount =', Math.max(0, ...layer) + 1);
  }

  // слои -> списки id
  const layers: string[][] = Array.from({ length: maxL + 1 }, () => []);
  nodeIds.forEach((id, i) => layers[layer[i]].push(id));

  // DEBUG: наполнение слоёв
  if (__dbgEnabled) {
    const dbgSize = layers.map((arr, i) => ({ layer: i, count: arr.length, ids: arr.slice() }));
    // eslint-disable-next-line no-console
    console.dir({ layers: dbgSize }, { depth: null });
  }

  // DEBUG: геометрия колонок
  if (__dbgEnabled) {
    // eslint-disable-next-line no-console
    console.log('width=', width, 'padding=', padding, 'innerW=', Math.max(1, width - padding * 2));
  }

  // --- геометрия колонок (равномерно по ширине) ---
  const nodeWidth = 12;
  const innerW = Math.max(1, width - padding * 2);
  const totalCols = Math.max(1, layers.length);
  const colStep = totalCols > 1 ? (innerW - nodeWidth) / (totalCols - 1) : 0;
  const colX0 = padding;

  // DEBUG: шаг колонок
  if (__dbgEnabled) {
    // eslint-disable-next-line no-console
   console.log('totalCols=', totalCols, 'colStep=', colStep, 'colX0=', colX0);
  }

  // --- вспомогательные функции ---
  const minNodeHeight = 18; // гарантированный минимум видимости
  const baseHeight = (id: string) => {
    const i = id2idx.get(id)!;
    const w = (inSum[i] + outSum[i]) * (linkWidthScale * 0.8);
    return Math.max(minNodeHeight, w);
  };

  const stableSortBy = <T,>(arr: T[], key: (x: T) => number) =>
    arr.map((v, i) => ({ v, i, k: key(v) }))
       .sort((a, b) => (a.k - b.k) || (a.i - b.i))
       .map(o => o.v);

  // вычисляем текущие центры слоя (для барицентра), без записи позиций
  const centers = new Map<string, number>();
  const placeLayer = (ids: string[], x: number, write = false, out?: Map<string, Pos>) => {
  const H = ids.map(baseHeight);
  const avail = Math.max(0, height - padding * 2);
  const gapsCount = Math.max(0, ids.length - 1);

  const sumH = H.reduce((a, b) => a + b, 0);
  const minGaps = gapsCount * nodeGap;

  let scale = 1;
  let gap = nodeGap;
  let topPad = padding;

  if (sumH + minGaps <= avail) {
    const leftover = avail - (sumH + minGaps);
    const extraPerGap = gapsCount > 0 ? leftover / (gapsCount + 2) : leftover / 2;
    gap = nodeGap + extraPerGap;
    topPad = padding + extraPerGap;
  } else {
    scale = (avail - minGaps) / Math.max(1, sumH);
    scale = Math.max(0.35, Math.min(1, scale));
  }

  // 🔹 Вставь этот блок прямо здесь
  if (__dbgEnabled) {
    console.log('[placeLayer] ids=', ids, 
                'avail=', avail, 
                'sumH=', sumH, 
                'minGaps=', minGaps,
                'scale=', scale, 
                'gap=', gap, 
                'topPad=', topPad);
  }

  // существующий цикл — не трогаем
  let y = topPad;
  for (let j = 0; j < ids.length; j++) {
    const id = ids[j];
    const h = H[j] * scale;
    if (write && out) out.set(id, { x, y, width: nodeWidth, height: h });
    centers.set(id, y + h / 2);
    y += h + (j < ids.length - 1 ? gap : 0);
  }
};


  // --- начальная раскладка (чтобы были центры) ---
  for (let li = 0; li < layers.length; li++) {
    placeLayer(layers[li], colX0 + colStep * li, false);
  }

  // --- барицентрическая сортировка ---
  const bary = (id: string, neighbors: Array<{ id: string; w: number }>) => {
    let sw = 0, s = 0;
    for (const nb of neighbors) {
      const c = centers.get(nb.id);
      if (c == null) continue;
      sw += nb.w; s += nb.w * c;
    }
    return sw > 0 ? s / sw : centers.get(id) ?? 0;
  };

  const ORDER_ITER = 5;
  for (let it = 0; it < ORDER_ITER; it++) {
    // слева-направо: сортируем по предкам
    for (let li = 1; li < layers.length; li++) {
      const ids = layers[li];
      layers[li] = stableSortBy(ids, id => bary(id, preds.get(id)!));
      placeLayer(layers[li], colX0 + colStep * li, false);
    }
    // справа-налево: сортируем по потомкам
    for (let li = layers.length - 2; li >= 0; li--) {
      const ids = layers[li];
      layers[li] = stableSortBy(ids, id => bary(id, succs.get(id)!));
      placeLayer(layers[li], colX0 + colStep * li, false);
    }
  }

  // --- финальная запись позиций ---
  const pos = new Map<string, Pos>();
  for (let li = 0; li < layers.length; li++) {
    placeLayer(layers[li], colX0 + colStep * li, true, pos);
  }

  // уважаем ручные фиксации (drag & snapshot)
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

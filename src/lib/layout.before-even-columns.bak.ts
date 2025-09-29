import type { SankeyData, SankeyOptions } from './types';

type Pos = { x: number; y: number; width: number; height: number };

interface LayoutResult {
  nodes: Map<string, Pos>;
}

/**
 * Слоёный лэйаут:
 * 1) Базово расставляет слои: источники слева (in=0), при DAG — по «длинейшему пути».
 * 2) fixedLayers переопределяют слой напрямую.
 * 3) pinRightIds перемещаются в самый правый слой (после нормализации).
 * 4) Внутри слоя узлы раскладываются столбиком с одинаковыми промежутками.
 * 5) Размеры узлов: ширина фикс. (12), высота ~ сумме потоков (вход/выход).
 */
export function autoLayout(
  data: SankeyData,
  opts: Pick<Required<SankeyOptions>,
    'width'|'height'|'padding'|'nodeGap'|'colGap'|'linkWidthScale'
  > & Partial<Pick<Required<SankeyOptions>, 'fixedLayers'|'pinRightIds'>>
): LayoutResult {

  const { width, height, padding, nodeGap, colGap, linkWidthScale } = opts;
  const fixedLayers = opts.fixedLayers ?? {};
  const pinRight = new Set(opts.pinRightIds ?? []);

  const nodes = data.nodes.map(n => n.id);
  const N = nodes.length;
  const id2idx = new Map<string, number>(nodes.map((id, i) => [id, i]));

  // агрегируем веса входов/выходов
  const inSum = new Array<number>(N).fill(0);
  const outSum = new Array<number>(N).fill(0);

  for (const l of data.links) {
    const si = id2idx.get(l.source); const ti = id2idx.get(l.target);
    if (si == null || ti == null) continue;
    outSum[si] += l.value;
    inSum[ti] += l.value;
  }

  // 1) начальный слой: источники = 0
  const layer = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) if (inSum[i] === 0 && outSum[i] > 0) layer[i] = 0;

  // 2) longest-path layering (ограничение итераций защищает от циклов)
  const ITER = 3 * N + 10;
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

  // 3) применяем fixedLayers
  for (const [id, lyr] of Object.entries(fixedLayers)) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = Math.max(0, Math.floor(lyr));
  }

  // 4) нормализация: minLayer -> 0
  const minL = Math.min(...layer);
  for (let i = 0; i < N; i++) layer[i] -= minL;

  // 5) pinRightIds -> самый правый слой
  let maxL = Math.max(0, ...layer);
  for (const id of pinRight) {
    const i = id2idx.get(id);
    if (i != null) layer[i] = maxL + 1;
  }
  maxL = Math.max(...layer);

  // 6) группируем по слоям
  const layers: string[][] = Array.from({ length: maxL + 1 }, () => []);
  nodes.forEach((id, i) => layers[layer[i]].push(id));

  // 7) размеры и координаты
  const nodeWidth = 12;
  const maxInnerW = width - padding * 2;
  const totalCols = Math.max(1, maxL + 1);
  const colX0 = padding;
  const colStep = Math.min(colGap, Math.max(80, (maxInnerW - nodeWidth) / Math.max(1, totalCols - 1)));

  const pos = new Map<string, Pos>();

  for (let li = 0; li < layers.length; li++) {
    const ids = layers[li];

    // порядок внутри слоя: узлы с большими потоками — ближе к центру колонки
    const order = [...ids].sort((a, b) => {
      const ia = id2idx.get(a)!; const ib = id2idx.get(b)!;
      const wa = inSum[ia] + outSum[ia];
      const wb = inSum[ib] + outSum[ib];
      return wb - wa;
    });

    const x = colX0 + colStep * li;

    const heights = order.map(id => {
      const i = id2idx.get(id)!;
      return Math.max(16, (inSum[i] + outSum[i]) * (linkWidthScale * 0.6));
    });

    const totalH = heights.reduce((a, b) => a + b, 0);
    const freeH = Math.max(0, height - padding * 2 - (order.length - 1) * nodeGap);
    const k = totalH > 0 ? Math.min(1, freeH / totalH) : 1;

    let y = padding + (freeH - totalH * k) / 2;
    for (let j = 0; j < order.length; j++) {
      const id = order[j];
      const h = heights[j] * k;
      pos.set(id, { x, y, width: nodeWidth, height: h });
      y += h + nodeGap;
    }
  }

  // уважение пользовательских фиксаций
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

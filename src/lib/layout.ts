import type { SankeyData, SankeyNode } from './types';

/**
 * Функция определяет "слои" узлов по топологической структуре
 * (источники → обработка → хранилища → потребители).
 */
export function computeLayers(data: SankeyData): Map<string, number> {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();

  // Инициализация
  data.nodes.forEach(n => {
    inDeg.set(n.id, 0);
    adj.set(n.id, []);
  });

  // Считаем входящие связи и граф смежности
  data.links.forEach(l => {
    adj.get(l.source)!.push(l.target);
    inDeg.set(l.target, (inDeg.get(l.target) || 0) + 1);
  });

  // Топологическая сортировка (Kahn)
  const q: string[] = [];
  inDeg.forEach((deg, id) => deg === 0 && q.push(id));

  const layer = new Map<string, number>();
  q.forEach(id => layer.set(id, 0));

  while (q.length) {
    const u = q.shift()!;
    const lu = layer.get(u) || 0;
    for (const v of adj.get(u)!) {
      layer.set(v, Math.max(layer.get(v) || 0, lu + 1));
      inDeg.set(v, (inDeg.get(v) || 0) - 1);
      if ((inDeg.get(v) || 0) === 0) q.push(v);
    }
  }

  // Изолированные узлы — кладём в слой 0
  data.nodes.forEach(n => {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  });

  return layer;
}

/**
 * Авторазмещение узлов на основе слоёв.
 * Если у узла заданы x/y — они имеют приоритет.
 */
export function autoLayout(
  data: SankeyData,
  opts: {
    width: number;
    height: number;
    padding: number;
    nodeGap: number;
    colGap: number;
    linkWidthScale: number;
  }
): {
  nodes: Map<string, { x: number; y: number; width: number; height: number }>;
} {
  const layers = computeLayers(data);

  // Группируем узлы по слоям
  const layerNodes = new Map<number, SankeyNode[]>();
  data.nodes.forEach(n => {
    const l = layers.get(n.id) || 0;
    if (!layerNodes.has(l)) layerNodes.set(l, []);
    layerNodes.get(l)!.push(n);
  });

  const columns = Array.from(layerNodes.keys()).sort((a, b) => a - b);
  const colCount = Math.max(1, columns.length);

  const innerW = opts.width - 2 * opts.padding;
  const colWidth = (colCount > 1)
    ? (innerW - (colCount - 1) * opts.colGap) / colCount
    : innerW;

  const nodes = new Map<string, { x: number; y: number; width: number; height: number }>();

  // Расчёт высоты каждого узла: по value исходящих/входящих связей
  const valueByNode = new Map<string, number>();
  data.nodes.forEach(n => valueByNode.set(n.id, 0));
  data.links.forEach(l => {
    valueByNode.set(l.source, (valueByNode.get(l.source) || 0) + l.value);
    valueByNode.set(l.target, Math.max(valueByNode.get(l.target) || 0, 0));
  });

  const defaultNodeWidth = 12;

  for (const col of columns) {
    const list = layerNodes.get(col)!;

    // Высоты узлов
    const heights = list.map(n =>
      Math.max(n.height ?? (valueByNode.get(n.id)! * opts.linkWidthScale), 12)
    );

    const totalH = heights.reduce((a, b) => a + b, 0) + opts.nodeGap * Math.max(0, list.length - 1);
    const innerH = opts.height - 2 * opts.padding;
    const startY = opts.padding + Math.max(0, (innerH - totalH) / 2);

    const x = opts.padding + col * (colWidth + opts.colGap) + Math.max(0, (colWidth - defaultNodeWidth) / 2);

    let y = startY;
    list.forEach((n, i) => {
      const width = n.width ?? defaultNodeWidth;
      const height = heights[i];
      nodes.set(n.id, {
        x: n.x ?? x,
        y: n.y ?? y,
        width,
        height
      });
      y += height + opts.nodeGap;
    });
  }

  // Для изолированных узлов
  data.nodes.forEach(n => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, {
        x: n.x ?? opts.padding,
        y: n.y ?? opts.padding,
        width: n.width ?? defaultNodeWidth,
        height: n.height ?? 24
      });
    }
  });

  return { nodes };
}

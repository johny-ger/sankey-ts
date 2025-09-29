export interface SankeyNode {
  id: string;
  label?: string;
  color?: string;
  /** Пользовательские координаты (если заданы — уважаются лэйаутом) */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface SankeyLink {
  id?: string;
  source: string;
  target: string;
  value: number;
  color?: string;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface LayoutSnapshot {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    color?: string;
  }>;
  /** Если есть — это «полный» снапшот (можно загрузить без CSV) */
  links?: SankeyLink[];
  options?: {
    linkWidthScale?: number;
  };
}

export interface SankeyOptions {
  width?: number;
  height?: number;
  padding?: number;
  nodeGap?: number;
  colGap?: number;
  linkWidthScale?: number;
  curvature?: number;
  defaultNodeColor?: string;
  defaultLinkColor?: string;
  draggable?: boolean;
  saveKey?: string;

  /**
   * Жёстко закреплённые слои для узлов: { "Имя узла": номер_слоя }.
   * Слой 0 — самый левый. Приоритетнее автолэйаута.
   */
  fixedLayers?: Record<string, number>;

  /**
   * Имена узлов, которые нужно поставить в самый правый слой (после всех).
   * Удобно для «Архива», «Выхода», «Списания» и пр.
   */
  pinRightIds?: string[];
}

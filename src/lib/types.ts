/**
 * Базовые типы данных для самописной библиотеки Sankey.
 * Здесь нет зависимостей от сторонних санки-библиотек.
 */

export type NodeID = string;

/** Узел диаграммы (прямоугольник, куда сходятся/из которого выходят потоки) */
export interface SankeyNode {
  /** Уникальный идентификатор узла */
  id: NodeID;
  /** Текстовая метка рядом с узлом (если не указана — используется id) */
  label?: string;
  /** Цвет заливки прямоугольника узла (CSS-цвет) */
  color?: string;

  /**
   * Пользовательское размещение (координаты в пикселях).
   * Если не заданы — применяется авторазмещение.
   */
  x?: number;
  y?: number;

  /** Ширина прямоугольника узла (px). По умолчанию берём 12px. */
  width?: number;

  /**
   * Визуальная высота узла (px). Если не задана — вычисляется
   * как функция суммарного потока (value) * linkWidthScale.
   */
  height?: number;
}

/** Связь (поток) между двумя узлами */
export interface SankeyLink {
  /** Опциональный id (если не указан — генерируется) */
  id?: string;
  /** Откуда идёт поток */
  source: NodeID;
  /** Куда идёт поток */
  target: NodeID;
  /** Величина потока (в условных единицах, влияет на толщину линии) */
  value: number;
  /** Цвет линии (если не указан — может наследоваться от source или быть дефолтным) */
  color?: string;
}

/** Полный набор данных диаграммы */
export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

/** Опции рендера/интерактива */
export interface SankeyOptions {
  /** Габариты SVG */
  width?: number;
  height?: number;

  /** Внешние отступы от краёв SVG */
  padding?: number;

  /** Вертикальный зазор между узлами в колонке при авторазмещении */
  nodeGap?: number;

  /** Горизонтальный промежуток между колонками */
  colGap?: number;

  /** Множитель толщины линии: px на единицу value */
  linkWidthScale?: number;

  /** Кривизна Безье (0..1) */
  curvature?: number;

  /** Цвет по умолчанию для узлов */
  defaultNodeColor?: string;

  /** Цвет по умолчанию для связей */
  defaultLinkColor?: string;

  /** Разрешить перетаскивание узлов мышью */
  draggable?: boolean;

  /**
   * Ключ, под которым сохраняется раскладка в localStorage.
   * Если не указан — используется 'sankey-layout'.
   */
  saveKey?: string;
}

/** Снимок раскладки для сохранения/экспорта */
export interface LayoutSnapshot {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    color?: string;
  }>;
  options?: Partial<SankeyOptions>;
}

import type { SankeyData, SankeyOptions, LayoutSnapshot } from './types';
import { autoLayout } from './layout';
import { uid, clamp, svgEl } from './utils';
import { bezierLinkPath } from './core/geometry';
import { pickColor } from './core/color';
import { enableDrag } from './core/drag';
import { wireZoomPan, zoomAt } from './core/panzoom';

/**
 * Базовая SVG-диаграмма Sankey (состояние как в Контрольной точке 3),
 * но разнесённая по модулям: geometry, color, drag, panzoom.
 */
export class SankeyDiagram {
  // Должен быть публичным, чтобы соответствовать PanZoomHost
  public container: HTMLElement;
  public  svg: SVGSVGElement;
  private gLinks: SVGGElement;
  private gNodes: SVGGElement;
  private bgRect?: SVGRectElement;

  private data: SankeyData;
  private options: Required<SankeyOptions>;

  // позиции узлов
  private positions = new Map<string, { x: number; y: number; width: number; height: number }>();

  // viewBox
  public  vb = { x: 0, y: 0, w: 0, h: 0 };

  constructor(container: HTMLElement, data: SankeyData, options: SankeyOptions = {}) {
    this.container = container;
    this.data = {
      nodes: data.nodes.map(n => ({ ...n })),
      links: data.links.map(l => ({ id: l.id ?? uid('link'), ...l }))
    };

    this.options = {
      width: options.width ?? 960,
      height: options.height ?? 540,
      padding: options.padding ?? 24,
      nodeGap: options.nodeGap ?? 18,
      colGap: options.colGap ?? 120,
      linkWidthScale: options.linkWidthScale ?? 2,
      curvature: clamp(options.curvature ?? 0.5, 0, 1),
      defaultNodeColor: options.defaultNodeColor ?? '#4f46e5',
      defaultLinkColor: options.defaultLinkColor ?? '#94a3b8',
      draggable: options.draggable ?? true,
      saveKey: options.saveKey ?? 'sankey-layout',
      fixedLayers: options.fixedLayers ?? {},
      pinRightIds: options.pinRightIds ?? []
    };

    // SVG без width/height — управляем через viewBox
    this.container.innerHTML = '';
    this.svg = svgEl('svg', { class: 'sankey' });
    this.vb = { x: 0, y: 0, w: this.options.width, h: this.options.height };
    this.updateViewBox();

    // фон для панорамирования
    const gBg = svgEl('g', { class: 'sankey-bg' });
    this.bgRect = svgEl('rect', { x: 0, y: 0, width: this.options.width, height: this.options.height });
    this.bgRect.setAttribute('fill', 'transparent');
    this.bgRect.setAttribute('pointer-events', 'all');
    gBg.append(this.bgRect);

    this.gLinks = svgEl('g', { class: 'sankey-links' });
    this.gNodes = svgEl('g', { class: 'sankey-nodes' });

    this.svg.append(gBg, this.gLinks, this.gNodes);
    this.container.appendChild(this.svg);

    this.compute();
    this.render();

    // Зум/пан — модуль
    wireZoomPan(this);
  }

  /** Обновляет атрибут viewBox и фон */
  public updateViewBox() {
    this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    if (this.bgRect) {
      this.bgRect.setAttribute('x', String(this.vb.x));
      this.bgRect.setAttribute('y', String(this.vb.y));
      this.bgRect.setAttribute('width', String(this.vb.w));
      this.bgRect.setAttribute('height', String(this.vb.h));
    }
  }

  /** Программный resize (управляет только viewBox) */
  resize(width: number, height: number) {
    this.options.width = width;
    this.options.height = height;
    this.vb = { x: 0, y: 0, w: width, h: height };
    this.updateViewBox();
  }

  /** Масштаб толщины связей */
  setLinkWidthScale(scale: number) {
    this.options.linkWidthScale = Math.max(0.1, scale);
    this.compute();
    this.render();
  }

  setNodeColor(id: string, color: string) {
    const node = this.data.nodes.find(n => n.id === id);
    if (node) {
      node.color = color;
      this.renderNodes();
      this.renderLinks();
    }
  }
  setLinkColor(linkId: string, color: string) {
    const link = this.data.links.find(l => l.id === linkId);
    if (link) {
      link.color = color;
      this.renderLinks();
    }
  }

  setNodePosition(id: string, x: number, y: number) {
    const pos = this.positions.get(id);
    if (pos) {
      pos.x = x; pos.y = y;
      const node = this.data.nodes.find(n => n.id === id)!;
      node.x = x; node.y = y;
      this.render();
    }
  }

  /** Снимок диаграммы (узлы+связи+опции) */
  private snapshot(): LayoutSnapshot {
    const nodeSnaps = this.data.nodes.map(n => {
      const pos = this.positions.get(n.id)!;
      return { id: n.id, x: pos.x, y: pos.y, color: n.color, label: n.label, width: pos.width, height: pos.height };
    });
    const linksSnap = this.data.links.map(l => ({
      id: l.id, source: l.source, target: l.target, value: l.value, color: l.color
    }));
    return { nodes: nodeSnaps, links: linksSnap, options: { linkWidthScale: this.options.linkWidthScale } };
  }

  saveLayout(toLocalStorage = true): LayoutSnapshot {
    const snapshot = this.snapshot();
    if (toLocalStorage) localStorage.setItem(this.options.saveKey, JSON.stringify(snapshot));
    return snapshot;
  }
  saveLayoutAs(name: string): LayoutSnapshot {
    const clean = name.trim(); if (!clean) throw new Error('Имя сохранения не может быть пустым');
    const snap = this.snapshot();
    localStorage.setItem(`${this.options.saveKey}::layout::${clean}`, JSON.stringify(snap));
    const idxKey = `${this.options.saveKey}::index`;
    const idx = JSON.parse(localStorage.getItem(idxKey) || '[]') as string[];
    if (!idx.includes(clean)) idx.push(clean);
    localStorage.setItem(idxKey, JSON.stringify(idx));
    return snap;
  }
  listLayouts(): string[] {
    const idxKey = `${this.options.saveKey}::index`;
    const idx = JSON.parse(localStorage.getItem(idxKey) || '[]') as string[];
    return idx.sort((a, b) => a.localeCompare(b));
  }
  deleteLayout(name: string) {
    localStorage.removeItem(`${this.options.saveKey}::layout::${name}`);
    const idxKey = `${this.options.saveKey}::index`;
    const idx = (JSON.parse(localStorage.getItem(idxKey) || '[]') as string[]).filter(x => x !== name);
    localStorage.setItem(idxKey, JSON.stringify(idx));
  }

  loadLayout(from?: LayoutSnapshot | null) {
    const snapshot = from ?? JSON.parse(localStorage.getItem(this.options.saveKey) || 'null');
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }
  loadLayoutByName(name: string) {
    const raw = localStorage.getItem(`${this.options.saveKey}::layout::${name}`);
    if (!raw) return;
    this.applySnapshot(JSON.parse(raw) as LayoutSnapshot);
  }
  private applySnapshot(snapshot: LayoutSnapshot) {
    if (snapshot.links && Array.isArray(snapshot.links)) {
      const nodes = snapshot.nodes.map(n => ({ ...n }));
      const links = snapshot.links.map(l => ({ ...l }));
      this.setData({ nodes, links });
      if (snapshot.options?.linkWidthScale) this.options.linkWidthScale = snapshot.options.linkWidthScale;
      this.compute(); this.render();
      return;
    }
    // Старый формат: только координаты узлов
    const byId = new Map(this.data.nodes.map(n => [n.id, n]));
    snapshot.nodes.forEach(snap => {
      const n = byId.get(snap.id);
      if (n) { n.x = snap.x; n.y = snap.y; n.color = snap.color ?? n.color; n.label = snap.label ?? n.label; }
    });
    if (snapshot.options?.linkWidthScale) this.options.linkWidthScale = snapshot.options.linkWidthScale;
    this.compute(); this.render();
  }

  exportLayoutJSON(): string { return JSON.stringify(this.saveLayout(false), null, 2); }

  setData(data: SankeyData) {
    this.data = {
      nodes: data.nodes.map(n => ({ ...n })),
      links: data.links.map(l => ({ id: l.id ?? uid('link'), ...l }))
    };
    this.compute();
    this.render();
  }

  /** Расчёт позиций узлов */
  private compute() {
    const { nodes } = autoLayout(this.data, {
      width: this.options.width,
      height: this.options.height,
      padding: this.options.padding,
      nodeGap: this.options.nodeGap,
      colGap: this.options.colGap,
      linkWidthScale: this.options.linkWidthScale,
      fixedLayers: this.options.fixedLayers,
      pinRightIds: this.options.pinRightIds
    });
    this.positions = nodes;
  }

  /** Полная перерисовка */
  render() {
    this.gLinks.innerHTML = '';
    this.gNodes.innerHTML = '';
    this.renderLinks();
    this.renderNodes();
  }

  private renderLinks() {
    const links = [...this.data.links].sort((a, b) => b.value - a.value);
    for (const l of links) {
      const s = this.positions.get(l.source);
      const t = this.positions.get(l.target);
      if (!s || !t) continue;

      const d = bezierLinkPath(s, t, this.options.curvature);
      const path = svgEl('path', { class: 'sankey-link', d });
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke',
        l.color || this.data.nodes.find(n => n.id === l.source)?.color || this.options.defaultLinkColor
      );
      path.setAttribute('stroke-width', String(Math.max(1, l.value * this.options.linkWidthScale)));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', '0.9');
      path.setAttribute('data-id', l.id!);

      path.addEventListener('mouseenter', () => path.setAttribute('opacity', '1'));
      path.addEventListener('mouseleave', () => path.setAttribute('opacity', '0.9'));
      path.addEventListener('dblclick', () => pickColor(
        l.color || this.options.defaultLinkColor,
        (color) => this.setLinkColor(l.id!, color)
      ));

      this.gLinks.appendChild(path);
    }
  }

  private renderNodes() {
    for (const n of this.data.nodes) {
      const pos = this.positions.get(n.id)!;
      const g = svgEl('g', { class: 'sankey-node' });
      g.setAttribute('data-id', n.id);

      const rect = svgEl('rect', { x: pos.x, y: pos.y, rx: 6, ry: 6, width: pos.width, height: pos.height });
      rect.setAttribute('fill', n.color || this.options.defaultNodeColor);
      rect.setAttribute('filter', 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))');

      const label = svgEl('text', { x: pos.x + pos.width + 8, y: pos.y + pos.height / 2 });
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('class', 'sankey-label');
      label.textContent = n.label ?? n.id;

      g.append(rect, label);
      this.gNodes.appendChild(g);

      if (this.options.draggable) enableDrag(this, g as SVGGElement, n.id);

      g.addEventListener('dblclick', () => pickColor(
        n.color || this.options.defaultNodeColor,
        (color) => this.setNodeColor(n.id, color)
      ));
    }
  }

  /** Перевод клиентских координат в координаты SVG с учётом текущего viewBox */
  public clientToSvg(clientX: number, clientY: number) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const sp = pt.matrixTransform(ctm.inverse());
    return { x: sp.x, y: sp.y };
  }

  /** Fit/Zoom helpers для UI */
  fit() {
    this.vb = { x: 0, y: 0, w: this.options.width, h: this.options.height };
    this.updateViewBox();
  }
  zoomIn(factor = 1.2, center?: { clientX: number; clientY: number }) { zoomAt(this, factor, center); }
  zoomOut(factor = 1 / 1.2, center?: { clientX: number; clientY: number }) { zoomAt(this, factor, center); }
}

import type {
  SankeyData,
  SankeyOptions,
  LayoutSnapshot
} from './types';
import { autoLayout } from './layout';
import { uid, clamp, svgEl } from './utils';

/**
 * SVG Sankey с интерактивом:
 * - перетаскивание узлов, двойной клик — смена цвета
 * - именованные сохранения в localStorage
 * - загрузка/применение раскладки
 * - замена данных (CSV -> SankeyData)
 * - зум/пан/fit через viewBox
 */
export class SankeyDiagram {
  private container: HTMLElement;
  private svg: SVGSVGElement;
  private gLinks: SVGGElement;
  private gNodes: SVGGElement;
  private bgRect?: SVGRectElement; // фон для пэна

  private data: SankeyData;
  private options: Required<SankeyOptions>;

  // позиции узлов
  private positions = new Map<string, { x: number; y: number; width: number; height: number }>();

  // viewBox (для зума/пэна)
  private vb = { x: 0, y: 0, w: 0, h: 0 };
  private isPanning = false;
  private panStart = { x: 0, y: 0 };

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
      saveKey: options.saveKey ?? 'sankey-layout'
    };

    // SVG без width/height (размер—через CSS); управляем только viewBox
    this.container.innerHTML = '';
    this.svg = svgEl('svg', { class: 'sankey' });
    this.vb = { x: 0, y: 0, w: this.options.width, h: this.options.height };
    this.updateViewBox();

    // Фон для пэна (синхронизируем с viewBox)
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

    this.wireResizeObserver(); // no-op (см. ниже)
    this.wireZoomPan();
  }

  /** ----- LocalStorage ключи для именованных сохранений ----- */
  private get storageKeyIndex() { return `${this.options.saveKey}::index`; }
  private storageKeyOf(name: string) { return `${this.options.saveKey}::layout::${name}`; }
  private readIndex(): string[] { try { return JSON.parse(localStorage.getItem(this.storageKeyIndex) || '[]') || []; } catch { return []; } }
  private writeIndex(names: string[]) { localStorage.setItem(this.storageKeyIndex, JSON.stringify(Array.from(new Set(names)))); }

  /** ----- ViewBox helpers ----- */
  private updateViewBox() {
    this.svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
    if (this.bgRect) {
      const pad = 0;
      this.bgRect.setAttribute('x', String(this.vb.x - pad));
      this.bgRect.setAttribute('y', String(this.vb.y - pad));
      this.bgRect.setAttribute('width', String(this.vb.w + pad * 2));
      this.bgRect.setAttribute('height', String(this.vb.h + pad * 2));
    }
  }

  /** Отключено, чтобы не было циклов layout-а. Размер SVG задаётся через CSS. */
  private wireResizeObserver() { /* no-op to avoid layout loops */ }

  /** Программный resize: обновляем лишь viewBox (CSS задаёт реальный размер) */
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

  private snapshot(): LayoutSnapshot {
    return {
      nodes: this.data.nodes.map(n => ({
        id: n.id,
        x: this.positions.get(n.id)!.x,
        y: this.positions.get(n.id)!.y,
        color: n.color
      })),
      options: { linkWidthScale: this.options.linkWidthScale }
    };
  }

  saveLayout(toLocalStorage = true): LayoutSnapshot {
    const snapshot = this.snapshot();
    if (toLocalStorage) {
      localStorage.setItem(this.options.saveKey, JSON.stringify(snapshot));
    }
    return snapshot;
  }

  saveLayoutAs(name: string): LayoutSnapshot {
    const clean = name.trim();
    if (!clean) throw new Error('Имя сохранения не может быть пустым');
    const snap = this.snapshot();
    localStorage.setItem(this.storageKeyOf(clean), JSON.stringify(snap));
    const idx = this.readIndex();
    if (!idx.includes(clean)) idx.push(clean);
    this.writeIndex(idx);
    return snap;
  }

  listLayouts(): string[] { return this.readIndex().sort((a, b) => a.localeCompare(b)); }
  deleteLayout(name: string) {
    const clean = name.trim();
    localStorage.removeItem(this.storageKeyOf(clean));
    this.writeIndex(this.readIndex().filter(n => n !== clean));
  }

  loadLayout(from?: LayoutSnapshot | null) {
    const snapshot = from ?? JSON.parse(localStorage.getItem(this.options.saveKey) || 'null');
    if (!snapshot) return;
    this.applySnapshot(snapshot);
  }
  loadLayoutByName(name: string) {
    const raw = localStorage.getItem(this.storageKeyOf(name));
    if (!raw) return;
    const snapshot = JSON.parse(raw) as LayoutSnapshot;
    this.applySnapshot(snapshot);
  }
  private applySnapshot(snapshot: LayoutSnapshot) {
    const byId = new Map(this.data.nodes.map(n => [n.id, n]));
    snapshot.nodes.forEach(s => {
      const n = byId.get(s.id);
      if (n) {
        n.x = s.x; n.y = s.y;
        if (s.color) n.color = s.color;
      }
    });
    if (snapshot.options?.linkWidthScale) this.options.linkWidthScale = snapshot.options.linkWidthScale;
    this.compute();
    this.render();
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

  /** Расчёт позиций */
  private compute() {
    const { nodes } = autoLayout(this.data, {
      width: this.options.width,
      height: this.options.height,
      padding: this.options.padding,
      nodeGap: this.options.nodeGap,
      colGap: this.options.colGap,
      linkWidthScale: this.options.linkWidthScale
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

  private linkPath(
    source: { x: number; y: number; width: number; height: number },
    target: { x: number; y: number; width: number; height: number }
  ) {
    const sx = source.x + source.width;
    const sy = source.y + source.height / 2;
    const tx = target.x;
    const ty = target.y + target.height / 2;

    const dx = tx - sx;
    const c = this.options.curvature;
    const c1x = sx + dx * c;
    const c1y = sy;
    const c2x = tx - dx * c;
    const c2y = ty;

    return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
  }

  private renderLinks() {
    const links = [...this.data.links].sort((a, b) => b.value - a.value);
    for (const l of links) {
      const s = this.positions.get(l.source);
      const t = this.positions.get(l.target);
      if (!s || !t) continue;

      const path = svgEl('path', { class: 'sankey-link', d: this.linkPath(s, t) });
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

      path.addEventListener('dblclick', () => this.pickColor(
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

      if (this.options.draggable) this.enableDrag(g as SVGGElement, n.id);

      g.addEventListener('dblclick', () => this.pickColor(
        n.color || this.options.defaultNodeColor,
        (color) => this.setNodeColor(n.id, color)
      ));
    }
  }

  private pickColor(initial: string, onPick: (color: string) => void) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = initial;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.click();

    input.oninput = () => onPick(input.value);
    input.onchange = () => { onPick(input.value); document.body.removeChild(input); };
    input.onblur = () => { if (document.body.contains(input)) document.body.removeChild(input); };
  }

  private enableDrag(g: SVGGElement, nodeId: string) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof SVGElement)) return;
      dragging = true;
      const pos = this.positions.get(nodeId)!;
      const pt = this.clientToSvg(e.clientX, e.clientY);
      offsetX = pt.x - pos.x;
      offsetY = pt.y - pos.y;
      g.classList.add('dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const pt = this.clientToSvg(e.clientX, e.clientY);
      const x = pt.x - offsetX;
      const y = pt.y - offsetY;
      this.setNodePosition(nodeId, x, y);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      g.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      this.saveLayout();
    };

    g.addEventListener('mousedown', onDown);
  }

  private clientToSvg(clientX: number, clientY: number) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const sp = pt.matrixTransform(ctm.inverse());
    return { x: sp.x, y: sp.y };
  }

  /** ----- Fit/Zoom/Pan ----- */
  fit() {
    this.vb = { x: 0, y: 0, w: this.options.width, h: this.options.height };
    this.updateViewBox();
  }
  zoomIn(factor = 1.2, center?: { clientX: number; clientY: number }) {
    this.zoomAt(factor, center);
  }
  zoomOut(factor = 1 / 1.2, center?: { clientX: number; clientY: number }) {
    this.zoomAt(factor, center);
  }
  private zoomAt(factor: number, center?: { clientX: number; clientY: number }) {
    const minW = this.options.width / 8;
    const maxW = this.options.width * 4;
    const pt = center
      ? this.clientToSvg(center.clientX, center.clientY)
      : { x: this.vb.x + this.vb.w / 2, y: this.vb.y + this.vb.h / 2 };

    const newW = Math.min(maxW, Math.max(minW, this.vb.w / factor));
    const newH = newW * (this.vb.h / this.vb.w);

    const kx = (pt.x - this.vb.x) / this.vb.w;
    const ky = (pt.y - this.vb.y) / this.vb.h;
    const newX = pt.x - kx * newW;
    const newY = pt.y - ky * newH;

    this.vb = { x: newX, y: newY, w: newW, h: newH };
    this.updateViewBox();
  }

  private wireZoomPan() {
  // Зум колёсиком к курсору (оставляем как было)
  this.svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY > 0) this.zoomOut(1 / 0.9, { clientX: e.clientX, clientY: e.clientY });
    else this.zoomIn(0.9, { clientX: e.clientX, clientY: e.clientY });
  }, { passive: false });

  // Пэн: через Pointer Events + фиксированный масштаб (убирает дрожь)
  const canPanTarget = (t: EventTarget | null) =>
    !!(t && t instanceof Element && !t.closest('.sankey-node') && !t.closest('.sankey-link'));

  let panScaleX = 1, panScaleY = 1;
  let lastClientX = 0, lastClientY = 0;
  let accDX = 0, accDY = 0;
  let rafId: number | null = null;

  const schedule = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (accDX !== 0 || accDY !== 0) {
        this.vb.x -= accDX;
        this.vb.y -= accDY;
        accDX = accDY = 0;
        this.updateViewBox();
      }
    });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!this.isPanning) return;
    // переводим дельты из клиентских пикселей в координаты viewBox
    const dx = (e.clientX - lastClientX) * panScaleX;
    const dy = (e.clientY - lastClientY) * panScaleY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    accDX += dx;
    accDY += dy;
    schedule();
  };

  const onPointerUp = () => {
    if (!this.isPanning) return;
    this.isPanning = false;
    (this.container as HTMLElement).style.cursor = '';
    this.svg.releasePointerCapture(activePointerId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  let activePointerId = -1;

  this.svg.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!canPanTarget(e.target)) return;

    // коэффициенты перевода px -> координаты viewBox фиксируем НА СТАРТЕ
    const rect = this.svg.getBoundingClientRect();
    // сколько «координат viewBox» приходится на один клиентский пиксель
    panScaleX = this.vb.w / Math.max(1, rect.width);
    panScaleY = this.vb.h / Math.max(1, rect.height);

    this.isPanning = true;
    activePointerId = e.pointerId;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    accDX = accDY = 0;

    (this.container as HTMLElement).style.cursor = 'grabbing';
    this.svg.setPointerCapture(activePointerId);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
  });
}
}

export interface PanZoomHost {
  svg: SVGSVGElement;
  container: HTMLElement;
  vb: { x: number; y: number; w: number; h: number };
  updateViewBox(): void;
  clientToSvg(clientX: number, clientY: number): { x: number; y: number };
}

/** Подключает wheel-zoom + панорамирование Pointer Events. */
export function wireZoomPan(host: PanZoomHost) {
  const { svg, container } = host;
  let isPanning = false;
  let panScaleX = 1, panScaleY = 1;
  let lastClientX = 0, lastClientY = 0;
  let accDX = 0, accDY = 0;
  let rafId: number | null = null;
  let activePointerId = -1;

  const canPanTarget = (t: EventTarget | null) =>
    !!(t && t instanceof Element && !t.closest('.sankey-node') && !t.closest('.sankey-link'));

  const schedule = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (accDX || accDY) {
        host.vb.x -= accDX;
        host.vb.y -= accDY;
        accDX = accDY = 0;
        host.updateViewBox();
      }
    });
  };

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 0.9 : 0.9;
    zoomAt(host, factor, { clientX: e.clientX, clientY: e.clientY });
  }, { passive: false });

  const onPointerMove = (e: PointerEvent) => {
    if (!isPanning) return;
    const dx = (e.clientX - lastClientX) * panScaleX;
    const dy = (e.clientY - lastClientY) * panScaleY;
    lastClientX = e.clientX; lastClientY = e.clientY;
    accDX += dx; accDY += dy; schedule();
  };

  const onPointerUp = () => {
    if (!isPanning) return;
    isPanning = false;
    container.style.cursor = '';
    try { svg.releasePointerCapture(activePointerId); } catch {}
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  svg.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!canPanTarget(e.target)) return;

    const rect = svg.getBoundingClientRect();
    panScaleX = host.vb.w / Math.max(1, rect.width);
    panScaleY = host.vb.h / Math.max(1, rect.height);

    isPanning = true;
    activePointerId = e.pointerId;
    lastClientX = e.clientX; lastClientY = e.clientY;
    accDX = accDY = 0;

    container.style.cursor = 'grabbing';
    try { svg.setPointerCapture(activePointerId); } catch {}
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
  });
}

export function zoomAt(host: PanZoomHost, factor: number, center?: { clientX: number; clientY: number }) {
  const minW = host.vb.w / 8;
  const maxW = host.vb.w * 4;

  const pt = center
    ? host.clientToSvg(center.clientX, center.clientY)
    : { x: host.vb.x + host.vb.w / 2, y: host.vb.y + host.vb.h / 2 };

  const newW = Math.min(maxW, Math.max(minW, host.vb.w / factor));
  const newH = newW * (host.vb.h / host.vb.w);

  const kx = (pt.x - host.vb.x) / host.vb.w;
  const ky = (pt.y - host.vb.y) / host.vb.h;
  host.vb = { x: pt.x - kx * newW, y: pt.y - ky * newH, w: newW, h: newH };
  host.updateViewBox();
}

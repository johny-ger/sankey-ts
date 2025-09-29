export interface DragHost {
  clientToSvg(clientX: number, clientY: number): { x: number; y: number };
  setNodePosition(id: string, x: number, y: number): void;
  saveLayout(toLocalStorage?: boolean): unknown;
}

/** Подключает drag&drop к группе узла. */
export function enableDrag(host: DragHost, g: SVGGElement, nodeId: string) {
  let dragging = false;
  let offsetX = 0, offsetY = 0;

  const onDown = (e: MouseEvent) => {
    if (!(e.target instanceof SVGElement)) return;
    dragging = true;
    const pt = host.clientToSvg(e.clientX, e.clientY);
    const rect = (g.querySelector('rect') as SVGRectElement | null);
    const x = rect ? Number(rect.getAttribute('x') || 0) : 0;
    const y = rect ? Number(rect.getAttribute('y') || 0) : 0;
    offsetX = pt.x - x;
    offsetY = pt.y - y;
    g.classList.add('dragging');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const pt = host.clientToSvg(e.clientX, e.clientY);
    host.setNodePosition(nodeId, pt.x - offsetX, pt.y - offsetY);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    g.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    host.saveLayout?.();
  };

  g.addEventListener('mousedown', onDown);
}

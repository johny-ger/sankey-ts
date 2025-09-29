export type Box = { x: number; y: number; width: number; height: number };

/** S-образная кривая Безье между правой стороной source и левой стороной target. */
export function bezierLinkPath(source: Box, target: Box, curvature: number) {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;

  const dx = tx - sx;
  const c = Math.max(0, Math.min(1, curvature));
  const c1x = sx + dx * c;
  const c1y = sy;
  const c2x = tx - dx * c;
  const c2y = ty;

  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
}

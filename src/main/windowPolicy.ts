export interface WindowEntry { id: number; kind: 'manual' | 'toolbar' | 'result'; pinned: boolean }
export function replaceableResults(windows: WindowEntry[]): number[] { return windows.filter(window => window.kind === 'result' && !window.pinned).map(window => window.id); }
export function fitBounds(point: { x: number; y: number }, size: { width: number; height: number }, area: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(size.width, area.width - 12), height = Math.min(size.height, area.height - 12);
  return { width, height, x: Math.round(Math.max(area.x + 6, Math.min(point.x, area.x + area.width - width - 6))), y: Math.round(Math.max(area.y + 6, Math.min(point.y, area.y + area.height - height - 6))) };
}

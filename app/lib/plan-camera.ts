/** Shared world-coordinate camera. Screen size changes never move its centre. */
export interface PlanCamera { x: number; y: number; unitsPerPixel: number }
export interface PlanCameraProps { camera?: PlanCamera; onCameraChange?: (camera: PlanCamera) => void }
export function fitPlan(minX: number, minY: number, maxX: number, maxY: number, width: number, height: number): PlanCamera {
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
    unitsPerPixel: Math.max(Math.max(maxX - minX, 1) / Math.max(width - 68, 1), Math.max(maxY - minY, 1) / Math.max(height - 68, 1)) };
}
/** factor < 1 zooms in; dx/dy are screen offsets from the viewport centre. */
export function zoomPlan(camera: PlanCamera, factor: number, dx = 0, dy = 0): PlanCamera {
  const unitsPerPixel = Math.min(10000, Math.max(0.0001, camera.unitsPerPixel * factor));
  return { x: camera.x + dx * (camera.unitsPerPixel - unitsPerPixel),
    y: camera.y - dy * (camera.unitsPerPixel - unitsPerPixel), unitsPerPixel };
}
export function panPlan(camera: PlanCamera, dx: number, dy: number): PlanCamera {
  return { ...camera, x: camera.x - dx * camera.unitsPerPixel, y: camera.y + dy * camera.unitsPerPixel };
}
export function planViewBox(camera: PlanCamera, width: number, height: number): number[] {
  const w = width * camera.unitsPerPixel, h = height * camera.unitsPerPixel;
  return [camera.x - w / 2, -camera.y - h / 2, w, h];
}

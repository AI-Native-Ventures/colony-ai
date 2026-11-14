export const COMPANY_MAP_MIN_SCALE = 0.7;
export const COMPANY_MAP_MAX_SCALE = 1.3;
export const COMPANY_MAP_MIN_VISIBLE_PX = 72;

export type CompanyMapCamera = {
  scale: number;
  x: number;
  y: number;
};

export type CompanyMapPoint = {
  x: number;
  y: number;
};

export type CompanyMapRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function clampCompanyMapScale(scale: number): number {
  return Math.min(
    COMPANY_MAP_MAX_SCALE,
    Math.max(COMPANY_MAP_MIN_SCALE, scale),
  );
}

/**
 * Keeps enough of the transformed company board in the viewport to make the
 * map recoverable through direct panning or the Fit control.
 */
export function clampCompanyMapCamera(
  camera: CompanyMapCamera,
  stage: CompanyMapRect,
  viewport: CompanyMapRect,
): CompanyMapCamera {
  const scale = clampCompanyMapScale(camera.scale);
  const scaledWidth = stage.width * scale;
  const scaledHeight = stage.height * scale;
  const visibleWidth = Math.min(COMPANY_MAP_MIN_VISIBLE_PX, scaledWidth);
  const visibleHeight = Math.min(COMPANY_MAP_MIN_VISIBLE_PX, scaledHeight);
  const scaleOffsetX = ((1 - scale) * stage.width) / 2;
  const scaleOffsetY = ((1 - scale) * stage.height) / 2;
  const minX =
    viewport.left + visibleWidth - stage.left - scaleOffsetX - scaledWidth;
  const maxX =
    viewport.left + viewport.width - visibleWidth - stage.left - scaleOffsetX;
  const minY =
    viewport.top + visibleHeight - stage.top - scaleOffsetY - scaledHeight;
  const maxY =
    viewport.top + viewport.height - visibleHeight - stage.top - scaleOffsetY;

  return {
    scale,
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
  };
}

/**
 * Changes scale while preserving the stage world point at `source` under
 * `target`. Passing the same point for both is pointer-centred wheel zoom;
 * distinct points combine pinch panning with pinch zooming.
 */
export function cameraForScaledPoint({
  camera,
  origin,
  scale,
  source,
  target,
}: {
  camera: CompanyMapCamera;
  origin: CompanyMapPoint;
  scale: number;
  source: CompanyMapPoint;
  target: CompanyMapPoint;
}): CompanyMapCamera {
  const nextScale = clampCompanyMapScale(scale);
  const worldX = (source.x - origin.x - camera.x) / camera.scale;
  const worldY = (source.y - origin.y - camera.y) / camera.scale;

  return {
    scale: nextScale,
    x: target.x - origin.x - worldX * nextScale,
    y: target.y - origin.y - worldY * nextScale,
  };
}

export function formatCompanyMapTransform(camera: CompanyMapCamera): string {
  return `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
}

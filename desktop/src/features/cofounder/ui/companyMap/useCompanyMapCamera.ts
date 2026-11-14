import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  cameraForScaledPoint,
  clampCompanyMapCamera,
  clampCompanyMapScale,
  formatCompanyMapTransform,
  type CompanyMapCamera,
  type CompanyMapPoint,
  type CompanyMapRect,
} from "./companyMapCamera";

const CAMERA_DRAG_THRESHOLD = 4;
const KEYBOARD_PAN_STEP = 48;
const WHEEL_GESTURE_END_MS = 110;
const WHEEL_SCALE_SENSITIVITY = 0.0015;

const START_CAMERA: CompanyMapCamera = { scale: 1, x: 0, y: 0 };

type CameraGeometry = {
  origin: CompanyMapPoint;
  stage: CompanyMapRect;
  viewport: CompanyMapRect;
};

type PointerGesture = CameraGeometry & {
  button: number;
  camera: CompanyMapCamera;
  pointerId: number;
  pointerType: string;
  start: CompanyMapPoint;
  started: boolean;
};

type PinchGesture = CameraGeometry & {
  camera: CompanyMapCamera;
  distance: number;
  source: CompanyMapPoint;
};

function toPoint(event: { clientX: number; clientY: number }): CompanyMapPoint {
  return { x: event.clientX, y: event.clientY };
}

function centerOf(
  first: CompanyMapPoint,
  second: CompanyMapPoint,
): CompanyMapPoint {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function distanceBetween(first: CompanyMapPoint, second: CompanyMapPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function sameCamera(first: CompanyMapCamera, second: CompanyMapCamera): boolean {
  return (
    first.scale === second.scale && first.x === second.x && first.y === second.y
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [role='textbox']",
      ),
    )
  );
}

function isMapControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element && Boolean(target.closest("[data-map-control]"))
  );
}

function isLeftDragCanvasTarget(target: EventTarget | null): boolean {
  return (
    !(target instanceof Element) ||
    !target.closest("button, a, [data-map-control], .company-map-card")
  );
}

function normalizeWheelDelta(
  event: ReactWheelEvent<HTMLDivElement>,
  viewportHeight: number,
): CompanyMapPoint {
  const multiplier =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  return { x: event.deltaX * multiplier, y: event.deltaY * multiplier };
}

/**
 * Owns the one desktop-map camera for buttons, wheel, keyboard, pointer, and
 * touch input. Gesture frames update only the stage transform; React state is
 * synchronized at the end of a gesture for controls and assistive text.
 */
export function useCompanyMapCamera({ disabled }: { disabled: boolean }) {
  const [camera, setCamera] = useState<CompanyMapCamera>(START_CAMERA);
  const cameraRef = useRef<CompanyMapCamera>(START_CAMERA);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const touchPointsRef = useRef(new Map<number, CompanyMapPoint>());
  const spacePressedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const suppressContextMenuRef = useRef(false);
  const interactionActiveRef = useRef(false);
  const wheelGeometryRef = useRef<CameraGeometry | null>(null);
  const wheelEndTimerRef = useRef<number | null>(null);
  const contextMenuResetTimerRef = useRef<number | null>(null);

  const readGeometry = useCallback((): CameraGeometry | null => {
    const stageElement = stageRef.current;
    const viewportElement = viewportRef.current;
    if (!stageElement || !viewportElement) return null;

    const stageBounds = stageElement.getBoundingClientRect();
    const viewportBounds = viewportElement.getBoundingClientRect();
    const current = cameraRef.current;
    const width = stageElement.offsetWidth;
    const height = stageElement.offsetHeight;
    const scaleOffsetX = ((1 - current.scale) * width) / 2;
    const scaleOffsetY = ((1 - current.scale) * height) / 2;
    const stage = {
      height,
      left: stageBounds.left - current.x - scaleOffsetX,
      top: stageBounds.top - current.y - scaleOffsetY,
      width,
    };
    const viewport = {
      height: viewportBounds.height,
      left: viewportBounds.left,
      top: viewportBounds.top,
      width: viewportBounds.width,
    };

    return {
      origin: {
        x: stage.left + stage.width / 2,
        y: stage.top + stage.height / 2,
      },
      stage,
      viewport,
    };
  }, []);

  const syncCameraState = useCallback((next: CompanyMapCamera) => {
    setCamera((current) => (sameCamera(current, next) ? current : next));
  }, []);

  const writeCamera = useCallback(
    (
      next: CompanyMapCamera,
      geometry: CameraGeometry | null = readGeometry(),
      synchronize = false,
    ): CompanyMapCamera => {
      const bounded = geometry
        ? clampCompanyMapCamera(next, geometry.stage, geometry.viewport)
        : { ...next, scale: clampCompanyMapScale(next.scale) };
      cameraRef.current = bounded;
      if (!disabled) {
        stageRef.current?.style.setProperty(
          "--company-map-transform",
          formatCompanyMapTransform(bounded),
        );
      }
      if (synchronize) syncCameraState(bounded);
      return bounded;
    },
    [disabled, readGeometry, syncCameraState],
  );

  const beginInteraction = useCallback(() => {
    if (interactionActiveRef.current) return;
    interactionActiveRef.current = true;
    viewportRef.current?.setAttribute("data-camera-interacting", "true");
  }, []);

  const finishInteraction = useCallback(() => {
    if (!interactionActiveRef.current) return;
    interactionActiveRef.current = false;
    viewportRef.current?.removeAttribute("data-camera-interacting");
    syncCameraState(cameraRef.current);
  }, [syncCameraState]);

  const clearWheelEndTimer = useCallback(() => {
    if (wheelEndTimerRef.current !== null) {
      window.clearTimeout(wheelEndTimerRef.current);
      wheelEndTimerRef.current = null;
    }
  }, []);

  const endCurrentGesture = useCallback(() => {
    clearWheelEndTimer();
    pointerGestureRef.current = null;
    pinchGestureRef.current = null;
    touchPointsRef.current.clear();
    wheelGeometryRef.current = null;
    finishInteraction();
  }, [clearWheelEndTimer, finishInteraction]);

  const scheduleWheelEnd = useCallback(() => {
    clearWheelEndTimer();
    wheelEndTimerRef.current = window.setTimeout(() => {
      wheelEndTimerRef.current = null;
      wheelGeometryRef.current = null;
      finishInteraction();
    }, WHEEL_GESTURE_END_MS);
  }, [clearWheelEndTimer, finishInteraction]);

  useLayoutEffect(() => {
    if (!disabled) writeCamera(cameraRef.current);
  }, [disabled, writeCamera]);

  useEffect(() => {
    if (disabled) endCurrentGesture();
  }, [disabled, endCurrentGesture]);

  useEffect(() => {
    const stageElement = stageRef.current;
    const viewportElement = viewportRef.current;
    if (
      !stageElement ||
      !viewportElement ||
      disabled ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    let frame: number | null = null;
    const clampAfterResize = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        writeCamera(cameraRef.current, readGeometry(), true);
      });
    };
    const observer = new ResizeObserver(clampAfterResize);
    observer.observe(stageElement);
    observer.observe(viewportElement);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [disabled, readGeometry, writeCamera]);

  useEffect(() => {
    const clearTransientInput = () => {
      spacePressedRef.current = false;
      suppressClickRef.current = false;
      suppressContextMenuRef.current = false;
      endCurrentGesture();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isEditableTarget(event.target)) {
        spacePressedRef.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") clearTransientInput();
    };

    window.addEventListener("blur", clearTransientInput);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", clearTransientInput);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWheelEndTimer();
      if (contextMenuResetTimerRef.current !== null) {
        window.clearTimeout(contextMenuResetTimerRef.current);
      }
    };
  }, [clearWheelEndTimer, endCurrentGesture]);

  const panBy = useCallback(
    (delta: CompanyMapPoint, synchronize = true) => {
      if (disabled) return;
      const geometry = readGeometry();
      const current = cameraRef.current;
      writeCamera(
        {
          scale: current.scale,
          x: current.x + delta.x,
          y: current.y + delta.y,
        },
        geometry,
        synchronize,
      );
    },
    [disabled, readGeometry, writeCamera],
  );

  const zoomAt = useCallback(
    (
      nextScale: number,
      source: CompanyMapPoint,
      target = source,
      geometry: CameraGeometry | null = readGeometry(),
      synchronize = true,
    ) => {
      if (disabled || !geometry) return;
      writeCamera(
        cameraForScaledPoint({
          camera: cameraRef.current,
          origin: geometry.origin,
          scale: nextScale,
          source,
          target,
        }),
        geometry,
        synchronize,
      );
    },
    [disabled, readGeometry, writeCamera],
  );

  const zoomCameraBy = useCallback(
    (amount: number) => {
      if (disabled) return;
      const geometry = readGeometry();
      if (!geometry) return;
      const nextScale = clampCompanyMapScale(cameraRef.current.scale + amount);
      if (nextScale <= 1) {
        writeCamera({ scale: nextScale, x: 0, y: 0 }, geometry, true);
        return;
      }
      const center = {
        x: geometry.viewport.left + geometry.viewport.width / 2,
        y: geometry.viewport.top + geometry.viewport.height / 2,
      };
      zoomAt(nextScale, center, center, geometry, true);
    },
    [disabled, readGeometry, writeCamera, zoomAt],
  );

  const fitCamera = useCallback(() => {
    if (disabled) return;
    writeCamera(START_CAMERA, readGeometry(), true);
  }, [disabled, readGeometry, writeCamera]);

  const startPointerPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, gesture: PointerGesture) => {
      if (gesture.started) return;
      gesture.started = true;
      if (gesture.button === 0 || gesture.pointerType === "touch") {
        suppressClickRef.current = true;
      }
      if (gesture.button === 2) suppressContextMenuRef.current = true;
      try {
        event.currentTarget.setPointerCapture(gesture.pointerId);
      } catch {
        // A cancelled pointer cannot be captured. Its cancel handler clears it.
      }
      beginInteraction();
    },
    [beginInteraction],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const geometry = readGeometry();
      if (!geometry) return;
      const point = toPoint(event);

      if (event.pointerType === "touch") {
        touchPointsRef.current.set(event.pointerId, point);
        const touches = [...touchPointsRef.current.values()];
        if (touches.length >= 2) {
          const [first, second] = touches;
          if (!first || !second) return;
          const distance = distanceBetween(first, second);
          if (distance === 0) return;
          pointerGestureRef.current = null;
          pinchGestureRef.current = {
            ...geometry,
            camera: { ...cameraRef.current },
            distance,
            source: centerOf(first, second),
          };
          suppressClickRef.current = true;
          for (const pointerId of touchPointsRef.current.keys()) {
            try {
              event.currentTarget.setPointerCapture(pointerId);
            } catch {
              // The platform may already have cancelled the first pointer.
            }
          }
          beginInteraction();
          event.preventDefault();
          return;
        }
        pointerGestureRef.current = {
          ...geometry,
          button: 0,
          camera: { ...cameraRef.current },
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          start: point,
          started: false,
        };
        return;
      }

      const startsPan =
        event.button === 1 ||
        event.button === 2 ||
        (event.button === 0 &&
          (spacePressedRef.current || isLeftDragCanvasTarget(event.target)));
      if (!startsPan) return;

      pointerGestureRef.current = {
        ...geometry,
        button: event.button,
        camera: { ...cameraRef.current },
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        start: point,
        started: false,
      };
      if (event.button === 1) event.preventDefault();
    },
    [beginInteraction, disabled, readGeometry],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const point = toPoint(event);
      if (event.pointerType === "touch") {
        touchPointsRef.current.set(event.pointerId, point);
        const pinch = pinchGestureRef.current;
        if (pinch) {
          const touches = [...touchPointsRef.current.values()];
          const [first, second] = touches;
          if (!first || !second) return;
          const distance = distanceBetween(first, second);
          if (distance === 0) return;
          const target = centerOf(first, second);
          const scale = pinch.camera.scale * (distance / pinch.distance);
          writeCamera(
            cameraForScaledPoint({
              camera: pinch.camera,
              origin: pinch.origin,
              scale,
              source: pinch.source,
              target,
            }),
            pinch,
          );
          event.preventDefault();
          return;
        }
      }

      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
      if (
        !gesture.started &&
        Math.hypot(delta.x, delta.y) < CAMERA_DRAG_THRESHOLD
      ) {
        return;
      }
      startPointerPan(event, gesture);
      writeCamera(
        {
          scale: gesture.camera.scale,
          x: gesture.camera.x + delta.x,
          y: gesture.camera.y + delta.y,
        },
        gesture,
      );
      event.preventDefault();
    },
    [disabled, startPointerPan, writeCamera],
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        const wasPinching = pinchGestureRef.current !== null;
        touchPointsRef.current.delete(event.pointerId);
        if (wasPinching) {
          endCurrentGesture();
          return;
        }
      }
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      pointerGestureRef.current = null;
      if (!gesture.started) return;
      if (gesture.button === 2) {
        if (contextMenuResetTimerRef.current !== null) {
          window.clearTimeout(contextMenuResetTimerRef.current);
        }
        contextMenuResetTimerRef.current = window.setTimeout(() => {
          suppressContextMenuRef.current = false;
          contextMenuResetTimerRef.current = null;
        }, 500);
      }
      finishInteraction();
    },
    [endCurrentGesture, finishInteraction],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        touchPointsRef.current.delete(event.pointerId);
      }
      if (
        pointerGestureRef.current?.pointerId === event.pointerId ||
        pinchGestureRef.current
      ) {
        endCurrentGesture();
      }
    },
    [endCurrentGesture],
  );

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const onContextMenuCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressContextMenuRef.current) return;
      suppressContextMenuRef.current = false;
      if (contextMenuResetTimerRef.current !== null) {
        window.clearTimeout(contextMenuResetTimerRef.current);
        contextMenuResetTimerRef.current = null;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (disabled || isMapControlTarget(event.target)) return;
      const geometry = wheelGeometryRef.current ?? readGeometry();
      if (!geometry) return;
      wheelGeometryRef.current = geometry;
      const delta = normalizeWheelDelta(event, geometry.viewport.height);
      if (delta.x === 0 && delta.y === 0) return;

      event.preventDefault();
      beginInteraction();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(
          cameraRef.current.scale * Math.exp(-delta.y * WHEEL_SCALE_SENSITIVITY),
          toPoint(event),
          toPoint(event),
          geometry,
          false,
        );
      } else {
        const current = cameraRef.current;
        writeCamera(
          {
            scale: current.scale,
            x: current.x - delta.x,
            y: current.y - delta.y,
          },
          geometry,
        );
      }
      scheduleWheelEnd();
    },
    [
      beginInteraction,
      disabled,
      readGeometry,
      scheduleWheelEnd,
      writeCamera,
      zoomAt,
    ],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
      if (
        disabled ||
        event.currentTarget !== event.target ||
        isEditableTarget(event.target)
      ) {
        return false;
      }

      if (event.code === "Space") {
        spacePressedRef.current = true;
        event.preventDefault();
        return true;
      }

      switch (event.code) {
        case "ArrowDown":
          panBy({ x: 0, y: -KEYBOARD_PAN_STEP });
          break;
        case "ArrowLeft":
          panBy({ x: KEYBOARD_PAN_STEP, y: 0 });
          break;
        case "ArrowRight":
          panBy({ x: -KEYBOARD_PAN_STEP, y: 0 });
          break;
        case "ArrowUp":
          panBy({ x: 0, y: KEYBOARD_PAN_STEP });
          break;
        case "Equal":
        case "NumpadAdd":
          zoomCameraBy(0.15);
          break;
        case "Minus":
        case "NumpadSubtract":
          zoomCameraBy(-0.15);
          break;
        case "Digit0":
        case "Numpad0":
          fitCamera();
          break;
        default:
          return false;
      }
      event.preventDefault();
      return true;
    },
    [disabled, fitCamera, panBy, zoomCameraBy],
  );

  const onKeyUp = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.code !== "Space") return;
    spacePressedRef.current = false;
    if (event.currentTarget === event.target) event.preventDefault();
  }, []);

  return {
    camera,
    fitCamera,
    onClickCapture,
    onContextMenuCapture,
    onKeyDown,
    onKeyUp,
    onLostPointerCapture: onPointerCancel,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onWheel,
    stageRef,
    viewportRef,
    zoomCameraBy,
  };
}

/**
 * 图助手抽屉的窗口化（浮动 / 停靠）与拖拽、缩放（图临时对话助手 · UI）。
 *
 * 默认停靠（dock）在画布右侧；窗口化后变为浮动（floating）窗口，可拖拽标题栏移动、
 * 右下角拖拽缩放。用原生 pointer events 实现，不引入额外依赖；位置与尺寸均限制在视口内。
 */
import { ref, type Ref } from "vue";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 600;
/** 浮动窗口与视口边缘的安全留白（px）。 */
const VIEWPORT_MARGIN = 16;

/** 把数值限制在 [min, max] 区间（max < min 时取 min，避免负区间）。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export interface FloatingWindow {
  floating: Ref<boolean>;
  x: Ref<number>;
  y: Ref<number>;
  width: Ref<number>;
  height: Ref<number>;
  toggleFloating: () => void;
  startDrag: (event: PointerEvent) => void;
  startResize: (event: PointerEvent) => void;
}

function viewportSize(): { w: number; h: number } {
  return { w: window.innerWidth, h: window.innerHeight };
}

export function useFloatingWindow(): FloatingWindow {
  const floating = ref(false);
  const x = ref(0);
  const y = ref(0);
  const width = ref(DEFAULT_WIDTH);
  const height = ref(DEFAULT_HEIGHT);

  /** 进入浮动：按视口给出初始尺寸与右上偏内的初始位置。 */
  function enterFloating(): void {
    const vp = viewportSize();
    width.value = clamp(DEFAULT_WIDTH, MIN_WIDTH, vp.w - VIEWPORT_MARGIN * 2);
    height.value = clamp(DEFAULT_HEIGHT, MIN_HEIGHT, vp.h - VIEWPORT_MARGIN * 2);
    x.value = clamp(vp.w - width.value - VIEWPORT_MARGIN, 0, vp.w - width.value);
    y.value = clamp(64, 0, vp.h - height.value);
    floating.value = true;
  }

  function toggleFloating(): void {
    if (floating.value) {
      floating.value = false;
      return;
    }
    enterFloating();
  }

  /** 拖拽标题栏移动窗口；移动范围限制在视口内。 */
  function startDrag(event: PointerEvent): void {
    if (!floating.value) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = x.value;
    const originY = y.value;
    const vp = viewportSize();

    const onMove = (move: PointerEvent): void => {
      x.value = clamp(originX + (move.clientX - startX), 0, vp.w - width.value);
      y.value = clamp(originY + (move.clientY - startY), 0, vp.h - height.value);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** 右下角拖拽缩放；尺寸限制在最小值与视口剩余空间之间。 */
  function startResize(event: PointerEvent): void {
    if (!floating.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const originW = width.value;
    const originH = height.value;
    const vp = viewportSize();

    const onMove = (move: PointerEvent): void => {
      width.value = clamp(originW + (move.clientX - startX), MIN_WIDTH, vp.w - x.value);
      height.value = clamp(originH + (move.clientY - startY), MIN_HEIGHT, vp.h - y.value);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { floating, x, y, width, height, toggleFloating, startDrag, startResize };
}

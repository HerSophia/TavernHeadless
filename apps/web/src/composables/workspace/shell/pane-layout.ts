import { computed, reactive } from "vue";

type PaneResizeTarget = "left" | "right";

type WorkspacePaneLayoutOptions = {
  centerMin: number;
  desktopBreakpoint?: number;
  initialLeftWidth?: number;
  initialRightWidth?: number;
  leftMin: number;
  rightMin: number;
};

export function useWorkspacePaneLayout(options: WorkspacePaneLayoutOptions) {
  const desktopBreakpoint = options.desktopBreakpoint ?? 1024;

  const paneLayout = reactive({
    leftWidth: options.initialLeftWidth ?? 320,
    resizing: null as PaneResizeTarget | null,
    rightWidth: options.initialRightWidth ?? 320,
    startLeft: options.initialLeftWidth ?? 320,
    startRight: options.initialRightWidth ?? 320,
    startX: 0
  });

  const leftPaneDesktopWidth = computed(() => paneLayout.leftWidth);
  const rightPaneDesktopWidth = computed(() => paneLayout.rightWidth);

  const paneLayoutStyles = computed<Record<string, string>>(() => ({
    "--left-pane-width": `${paneLayout.leftWidth}px`,
    "--right-pane-width": `${paneLayout.rightWidth}px`
  }));

  function clampPaneWidths(): void {
    if (window.innerWidth < desktopBreakpoint) {
      return;
    }

    const maxLeft = Math.max(options.leftMin, window.innerWidth - paneLayout.rightWidth - options.centerMin);
    const maxRight = Math.max(options.rightMin, window.innerWidth - paneLayout.leftWidth - options.centerMin);
    paneLayout.leftWidth = Math.min(maxLeft, Math.max(options.leftMin, paneLayout.leftWidth));
    paneLayout.rightWidth = Math.min(maxRight, Math.max(options.rightMin, paneLayout.rightWidth));
  }

  function stopPaneResize(): void {
    if (!paneLayout.resizing) {
      return;
    }

    paneLayout.resizing = null;
    document.body.classList.remove("pane-resizing");
    window.removeEventListener("mousemove", handlePaneResizeMove);
    window.removeEventListener("mouseup", stopPaneResize);
  }

  function handlePaneResizeMove(event: MouseEvent): void {
    if (!paneLayout.resizing) {
      return;
    }

    const delta = event.clientX - paneLayout.startX;
    if (paneLayout.resizing === "left") {
      const nextLeft = paneLayout.startLeft + delta;
      const maxLeft = Math.max(options.leftMin, window.innerWidth - paneLayout.rightWidth - options.centerMin);
      paneLayout.leftWidth = Math.min(maxLeft, Math.max(options.leftMin, nextLeft));
      return;
    }

    const nextRight = paneLayout.startRight - delta;
    const maxRight = Math.max(options.rightMin, window.innerWidth - paneLayout.leftWidth - options.centerMin);
    paneLayout.rightWidth = Math.min(maxRight, Math.max(options.rightMin, nextRight));
  }

  function beginPaneResize(target: PaneResizeTarget, event: MouseEvent): void {
    if (window.innerWidth < desktopBreakpoint) {
      return;
    }

    event.preventDefault();
    paneLayout.resizing = target;
    paneLayout.startX = event.clientX;
    paneLayout.startLeft = paneLayout.leftWidth;
    paneLayout.startRight = paneLayout.rightWidth;

    document.body.classList.add("pane-resizing");
    window.addEventListener("mousemove", handlePaneResizeMove);
    window.addEventListener("mouseup", stopPaneResize);
  }

  return {
    beginPaneResize,
    clampPaneWidths,
    leftPaneDesktopWidth,
    paneLayoutStyles,
    rightPaneDesktopWidth,
    stopPaneResize
  };
}

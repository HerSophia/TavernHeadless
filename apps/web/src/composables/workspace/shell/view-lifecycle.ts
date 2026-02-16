import { onBeforeUnmount, onMounted, watch } from "vue";

type UseWorkspaceViewLifecycleOptions = {
  clampPaneWidths: () => void;
  clearToasts: () => void;
  handleDocumentPointer: (event: MouseEvent) => void;
  handleGlobalKeydown: (event: KeyboardEvent) => void;
  handleWindowResize: () => void;
  hydrateFromApi: () => Promise<void>;
  lang: {
    value: string;
  };
  stopPaneResize: () => void;
};

export function useWorkspaceViewLifecycle(options: UseWorkspaceViewLifecycleOptions): void {
  onMounted(() => {
    void options.hydrateFromApi();
    options.clampPaneWidths();

    document.addEventListener("click", options.handleDocumentPointer);
    document.addEventListener("keydown", options.handleGlobalKeydown);
    window.addEventListener("resize", options.handleWindowResize);
  });

  watch(
    () => options.lang.value,
    (nextLang) => {
      document.documentElement.lang = nextLang;
    },
    {
      immediate: true
    }
  );

  onBeforeUnmount(() => {
    document.removeEventListener("click", options.handleDocumentPointer);
    document.removeEventListener("keydown", options.handleGlobalKeydown);
    window.removeEventListener("resize", options.handleWindowResize);
    options.clearToasts();
    options.stopPaneResize();
  });
}

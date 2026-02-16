import { ref } from "vue";

import type { WorkspaceInspectorTab } from "./inspector-view";

type UseWorkspaceShellStateOptions = {
  clampPaneWidths: () => void;
};

export function useWorkspaceShellState(options: UseWorkspaceShellStateOptions) {
  const activeTab = ref<WorkspaceInspectorTab>("bindings");
  const bindingFlash = ref(false);
  const showNavDrawer = ref(false);
  const showInspectorDrawer = ref(false);

  function toggleNavDrawer(): void {
    showNavDrawer.value = !showNavDrawer.value;
  }

  function toggleInspectorDrawer(): void {
    showInspectorDrawer.value = !showInspectorDrawer.value;
  }

  function closeDrawers(): void {
    showNavDrawer.value = false;
    showInspectorDrawer.value = false;
  }

  function closeNavDrawer(): void {
    showNavDrawer.value = false;
  }

  function closeInspectorDrawer(): void {
    showInspectorDrawer.value = false;
  }

  function resetActiveTab(): void {
    activeTab.value = "bindings";
  }

  function setActiveTab(tab: WorkspaceInspectorTab): void {
    activeTab.value = tab;
  }

  function flashBindingCard(): void {
    bindingFlash.value = true;
    window.setTimeout(() => {
      bindingFlash.value = false;
    }, 240);
  }

  function handleWindowResize(): void {
    closeDrawers();
    options.clampPaneWidths();
  }

  return {
    activeTab,
    bindingFlash,
    closeDrawers,
    closeInspectorDrawer,
    closeNavDrawer,
    flashBindingCard,
    handleWindowResize,
    resetActiveTab,
    setActiveTab,
    showInspectorDrawer,
    showNavDrawer,
    toggleInspectorDrawer,
    toggleNavDrawer
  };
}

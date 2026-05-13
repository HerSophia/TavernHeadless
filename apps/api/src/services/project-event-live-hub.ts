import type { ProjectEventRecord } from "./project-event-service.js";

export type ProjectEventListener = (event: ProjectEventRecord) => void;

/**
 * In-memory live hub for Project events.
 *
 * The hub only broadcasts events that were already persisted by ProjectEventService.
 * It is intentionally process-local in phase two.
 */
export class ProjectEventLiveHub {
  private readonly listenersByProject = new Map<string, Set<ProjectEventListener>>();

  subscribe(projectId: string, listener: ProjectEventListener): () => void {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    let listeners = this.listenersByProject.get(normalizedProjectId);
    if (!listeners) {
      listeners = new Set<ProjectEventListener>();
      this.listenersByProject.set(normalizedProjectId, listeners);
    }

    listeners.add(listener);

    return () => {
      const current = this.listenersByProject.get(normalizedProjectId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listenersByProject.delete(normalizedProjectId);
      }
    };
  }

  publish(event: ProjectEventRecord): void {
    const listeners = this.listenersByProject.get(event.projectId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch {
        // Live delivery must not affect other subscribers or the committed database event.
      }
    }
  }

  publishMany(events: readonly ProjectEventRecord[]): void {
    for (const event of events) {
      this.publish(event);
    }
  }

  listenerCount(projectId?: string): number {
    if (projectId) {
      return this.listenersByProject.get(projectId)?.size ?? 0;
    }

    let total = 0;
    for (const listeners of this.listenersByProject.values()) {
      total += listeners.size;
    }
    return total;
  }
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

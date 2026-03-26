import { useCallback, useSyncExternalStore } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ServiceStatus = "em_andamento" | "concluido";

export interface StatusEntry {
  /** Sequential follow-up number: 1 = first contact, 2 = second, etc. */
  followUp: number;
  status: ServiceStatus;
  date: string;   // ISO date  YYYY-MM-DD
  time: string;   // HH:mm
  observation: string;
}

export interface ServiceTracking {
  serviceId: string;
  entries: StatusEntry[];
}

// ── Storage key ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "xmx:status-tracking";

// ── Helpers ────────────────────────────────────────────────────────────────────

function readAll(): Record<string, ServiceTracking> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, ServiceTracking>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  // Notify subscribers
  window.dispatchEvent(new Event("xmx-status-change"));
}

// ── External store (React 18 pattern for localStorage) ─────────────────────────

let snapshot = readAll();

function subscribe(cb: () => void) {
  const handler = () => {
    snapshot = readAll();
    cb();
  };
  window.addEventListener("xmx-status-change", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("xmx-status-change", handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return snapshot;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useStatusTracking() {
  const trackingMap = useSyncExternalStore(subscribe, getSnapshot);

  /** Get current tracking data for a service */
  const getTracking = useCallback(
    (serviceId: string): ServiceTracking | null => {
      return trackingMap[serviceId] ?? null;
    },
    [trackingMap],
  );

  /** Get the current display status for a service */
  const getCurrentStatus = useCallback(
    (serviceId: string): { label: string; variant: "open" | "in-progress" | "done" } => {
      const tracking = trackingMap[serviceId];
      if (!tracking || tracking.entries.length === 0) {
        return { label: "Em Aberto", variant: "open" };
      }

      const last = tracking.entries[tracking.entries.length - 1];
      if (last.status === "concluido") {
        return { label: "Concluído", variant: "done" };
      }

      const count = tracking.entries.filter((e) => e.status === "em_andamento").length;
      if (count <= 1) {
        return { label: "Em Andamento", variant: "in-progress" };
      }
      return { label: `Em Andamento ${count}`, variant: "in-progress" };
    },
    [trackingMap],
  );

  /** Add a new status entry (follow-up) for a service */
  const addEntry = useCallback(
    (serviceId: string, entry: Omit<StatusEntry, "followUp">) => {
      const all = readAll();
      const existing = all[serviceId] ?? { serviceId, entries: [] };

      const followUp = existing.entries.length + 1;
      existing.entries.push({ ...entry, followUp });
      all[serviceId] = existing;

      writeAll(all);
    },
    [],
  );

  /** Get total follow-up count for a service */
  const getFollowUpCount = useCallback(
    (serviceId: string): number => {
      const tracking = trackingMap[serviceId];
      return tracking?.entries.length ?? 0;
    },
    [trackingMap],
  );

  return { getTracking, getCurrentStatus, addEntry, getFollowUpCount };
}

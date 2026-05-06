import { useEffect, useRef, useState } from "react";

import { AgentCheckInDialog } from "./AgentCheckInDialog";
import { AGENT_INTERACTION_EVENT } from "./agent-events";
import { useCheckInSnapshot } from "./useCheckInSnapshot";

type Props = {
  userId: string;
  fullName: string | null;
};

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TICK_MS = 30_000; // re-evaluate every 30s

type State = {
  /** ISO timestamp of the first tracked interaction of the SP-current day. */
  firstInteractionAt: string | null;
  /** Number of check-ins already acknowledged this SP-current day. */
  acknowledgedCount: number;
  /** ISO date (YYYY-MM-DD in SP) the state above belongs to. Used to reset on day rollover. */
  spDate: string | null;
};

const EMPTY_STATE: State = {
  firstInteractionAt: null,
  acknowledgedCount: 0,
  spDate: null,
};

function spTodayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function storageKey(userId: string): string {
  return `xmx:agent-checkin:${userId}`;
}

function loadState(userId: string): State {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<State>;
    return {
      firstInteractionAt: parsed.firstInteractionAt ?? null,
      acknowledgedCount: parsed.acknowledgedCount ?? 0,
      spDate: parsed.spDate ?? null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function saveState(userId: string, state: State): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

/**
 * Mounted once per agent session (inside AgentLayout). Owns the check-in
 * timer state, persists it across reloads via localStorage, listens for the
 * "first interaction of the day" event, and renders the modal at the right
 * cadence (every 2h after the first tracked interaction).
 *
 * State machine per SP day:
 *   firstInteractionAt = null  → idle
 *   firstInteractionAt set     → next due at first + 2h * (acknowledgedCount + 1)
 *   acknowledged               → increment acknowledgedCount, schedule next
 *   spDate changes             → reset everything (new day)
 */
export function AgentCheckInController({ userId, fullName }: Props) {
  const stateRef = useRef<State>(EMPTY_STATE);
  const [open, setOpen] = useState(false);
  const { snapshot, loading, refresh } = useCheckInSnapshot(userId);

  // Hydrate on mount / userId change
  useEffect(() => {
    const loaded = loadState(userId);
    const today = spTodayISO();
    if (loaded.spDate !== today) {
      // rollover — clear out
      stateRef.current = { ...EMPTY_STATE, spDate: today };
      saveState(userId, stateRef.current);
    } else {
      stateRef.current = loaded;
    }
  }, [userId]);

  // Listen for "agent:interaction" — capture first interaction of the day.
  useEffect(() => {
    function handler() {
      const today = spTodayISO();
      const s = stateRef.current;

      // Day rollover guard
      if (s.spDate !== today) {
        stateRef.current = { ...EMPTY_STATE, spDate: today };
      }

      if (!stateRef.current.firstInteractionAt) {
        stateRef.current = {
          ...stateRef.current,
          firstInteractionAt: new Date().toISOString(),
          spDate: today,
        };
        saveState(userId, stateRef.current);
      }
    }

    window.addEventListener(AGENT_INTERACTION_EVENT, handler);
    return () => window.removeEventListener(AGENT_INTERACTION_EVENT, handler);
  }, [userId]);

  // Periodically check whether a new check-in is due.
  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (cancelled) return;
      if (open) return; // already showing

      const today = spTodayISO();
      const s = stateRef.current;

      // Day rollover
      if (s.spDate !== today) {
        stateRef.current = { ...EMPTY_STATE, spDate: today };
        saveState(userId, stateRef.current);
        return;
      }

      if (!s.firstInteractionAt) return;

      const firstMs = new Date(s.firstInteractionAt).getTime();
      if (!Number.isFinite(firstMs)) return;

      const nextDueMs = firstMs + TWO_HOURS_MS * (s.acknowledgedCount + 1);
      if (Date.now() >= nextDueMs) {
        await refresh();
        if (!cancelled) setOpen(true);
      }
    }

    void evaluate();
    const id = window.setInterval(() => void evaluate(), TICK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refresh, open, userId]);

  function handleAcknowledge() {
    const s = stateRef.current;
    stateRef.current = {
      ...s,
      acknowledgedCount: s.acknowledgedCount + 1,
      spDate: spTodayISO(),
    };
    saveState(userId, stateRef.current);
    setOpen(false);
  }

  async function devTriggerCheckIn() {
    await refresh();
    setOpen(true);
  }

  return (
    <>
      <AgentCheckInDialog
        open={open}
        agentName={fullName}
        snapshot={snapshot}
        loading={loading}
        onAcknowledge={handleAcknowledge}
      />
      {/* Dev-only trigger. Vite replaces import.meta.env.DEV with `false`
          in production builds, so tree-shaking strips this block entirely. */}
      {import.meta.env.DEV && !open && (
        <button
          type="button"
          onClick={() => void devTriggerCheckIn()}
          className="fixed bottom-4 right-4 z-40 rounded-full border border-cyan-400/50 bg-slate-950/90 px-4 py-2 text-xs font-medium text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.4)] backdrop-blur transition hover:bg-slate-900 hover:shadow-[0_0_24px_rgba(34,211,238,0.6)]"
          title="Disparar o modal de check-in (apenas em dev)"
        >
          🧪 Testar Check-In
        </button>
      )}
    </>
  );
}

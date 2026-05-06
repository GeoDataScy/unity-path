/**
 * Lightweight CustomEvent bus to signal that the agent just performed a
 * meaningful interaction (creating a service or registering a follow-up).
 *
 * The check-in controller listens to this event to:
 *   1) record the timestamp of the FIRST interaction of the day, which
 *      anchors the recurring 2h check-in cadence.
 *   2) refresh the check-in snapshot if the dialog is currently open.
 *
 * Refunds intentionally do NOT emit this event — only attendance work
 * (atendimento + follow-up) anchors the timer per spec.
 */

export const AGENT_INTERACTION_EVENT = "agent:interaction";

export function emitAgentInteraction(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_INTERACTION_EVENT));
}

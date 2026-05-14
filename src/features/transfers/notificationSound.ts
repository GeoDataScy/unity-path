// Plays a short two-tone chime via Web Audio API. No asset file required.
// Browsers block audio until the user has interacted with the page; since agents
// always log in first, this is fine on /workspace pages.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export function playNotificationSound() {
  const ctx = getCtx();
  if (!ctx) return;

  // Resume if the browser auto-suspended the context (e.g. after a long idle).
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const playTone = (freq: number, startAt: number, duration: number, peak = 0.18) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration);
  };

  const now = ctx.currentTime;
  playTone(880, now, 0.16);        // A5
  playTone(1318.5, now + 0.1, 0.22); // E6
}

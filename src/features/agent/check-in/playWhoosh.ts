/**
 * Plays a futuristic "whoosh rise" sound via Web Audio API. No asset file
 * required — works in every modern browser (Chrome, Firefox, Safari, Edge).
 *
 * Browsers require a prior user gesture before AudioContext can produce sound.
 * This is fine for the agent check-in: by the time the dialog rises, the agent
 * has already clicked at least once on the page (to register the interaction
 * that started the 2h timer).
 *
 * Design: filtered white noise with a band-pass sweep from low → high → mid,
 * and a quick fade-in / soft fade-out envelope. ~600ms total.
 */
export function playWhoosh(): void {
  if (typeof window === "undefined") return;

  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) return;

  let ctx: AudioContext;
  try {
    ctx = new AudioCtor();
  } catch {
    return;
  }

  const duration = 0.6;
  const sampleRate = ctx.sampleRate;
  const samples = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(1, samples, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < samples; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.35;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.5;

  const t = ctx.currentTime;
  filter.frequency.setValueAtTime(220, t);
  filter.frequency.exponentialRampToValueAtTime(3800, t + duration * 0.65);
  filter.frequency.exponentialRampToValueAtTime(900, t + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.45, t + 0.06);
  gain.gain.linearRampToValueAtTime(0.55, t + duration * 0.55);
  gain.gain.linearRampToValueAtTime(0, t + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(t);
  noise.stop(t + duration);

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, (duration + 0.1) * 1000);
}

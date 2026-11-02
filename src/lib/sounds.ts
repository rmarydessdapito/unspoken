// Tiny synthesized sounds — no audio files needed. Respect the "sound effects" setting at the call site.

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationS: number, volume: number, type: OscillatorType = 'sine', when = 0) {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.015);
  gain.gain.setValueAtTime(volume, t0 + durationS - 0.04);
  gain.gain.linearRampToValueAtTime(0, t0 + durationS);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationS + 0.02);
}

/** the voicemail beep. resolves once it's finished so it isn't captured in the recording. */
export function playBeep(): Promise<void> {
  tone(1000, 0.32, 0.12, 'sine');
  return new Promise((r) => setTimeout(r, 420));
}

/** a soft click when recording ends */
export function playClick() {
  tone(220, 0.06, 0.12, 'triangle');
  tone(140, 0.05, 0.08, 'triangle', 0.05);
}

export function playSoftTap() {
  tone(520, 0.04, 0.05, 'sine');
}

export function haptic(enabled: boolean, pattern: number | number[] = 12) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

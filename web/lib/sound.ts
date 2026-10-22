/**
 * The village's sound, every bit of it made here with the Web Audio API rather
 * than played from files: no licences, nothing to download. On unless the
 * visitor has turned it off, though a browser holds it back until the page is
 * first touched (the setting in site-bar.tsx waits for that), and silent while
 * the tab is hidden. Nothing here can reach a match: it only listens.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;
let ambience: { stop: () => void } | null = null;
/** When the last bump sounded: several fights at once would otherwise be a din. */
let lastBump = 0;
/** Who wants to know when sound starts or stops actually playing: the speaker, so it can say it is waiting. */
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

const BUMP_GAP_MS = 110;
const VOLUME = 0.55;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    ctx.addEventListener("statechange", changed);
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else if (enabled) void ctx.resume();
    });
  }
  return { ctx, out: master! };
}

/** A second of white noise, made once and shared by everything that hisses, thumps or splashes. */
let noiseBuffer: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** A burst of filtered noise: the body of a thump, a clash or a splash. */
function burst(filter: BiquadFilterType, freq: number, toFreq: number, dur: number, gain: number, at = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const src = a.ctx.createBufferSource();
  src.buffer = noise(a.ctx);
  const f = a.ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, toFreq), t + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.out);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

/** One note: a shape, a pitch that may slide, a quick rise and a fall. */
function tone(type: OscillatorType, freq: number, dur: number, gain: number, at = 0, toFreq?: number): void {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const o = a.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/**
 * The village behind everything: wind that swells and settles, and a bird now
 * and then. Low, so the fights sit on top of it.
 */
function startAmbience(): { stop: () => void } | null {
  const a = audio();
  if (!a) return null;
  const src = a.ctx.createBufferSource();
  src.buffer = noise(a.ctx);
  src.loop = true;
  const f = a.ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 420;
  // A slow sway in the wind: an LFO on the filter.
  const lfo = a.ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = a.ctx.createGain();
  depth.gain.value = 180;
  lfo.connect(depth).connect(f.frequency);
  const g = a.ctx.createGain();
  g.gain.value = 0.045;
  src.connect(f).connect(g).connect(a.out);
  src.start();
  lfo.start();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const bird = () => {
    if (enabled && !document.hidden) {
      const base = 2200 + Math.random() * 1400;
      const chirps = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < chirps; i++) tone("sine", base, 0.09, 0.035, i * 0.13, base * (1.25 + Math.random() * 0.3));
    }
    timer = setTimeout(bird, 3000 + Math.random() * 7000);
  };
  timer = setTimeout(bird, 1500);

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      src.stop();
      lfo.stop();
      src.disconnect();
      g.disconnect();
    },
  };
}

export const sound = {
  get enabled() {
    return enabled;
  },

  /** Told whenever sound starts or stops actually playing; returns the way to stop being told. */
  subscribe(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },

  /** Actually playing: switched on, and let through by the browser. */
  get playing() {
    return enabled && ctx?.state === "running";
  },

  /** Switched on but held back by the browser until the page was touched: let it through now, from a touch. */
  wake(): void {
    if (enabled && ctx && ctx.state !== "running" && !document.hidden) void ctx.resume();
  },

  /** Turn sound on or off. On has to come from a click or a tap: that is what lets the browser play it. */
  setEnabled(on: boolean): void {
    enabled = on;
    const a = on ? audio() : null;
    if (on && a) {
      void a.ctx.resume();
      ambience ??= startAmbience();
    } else {
      ambience?.stop();
      ambience = null;
      if (ctx) void ctx.suspend();
    }
    changed();
  },

  /**
   * Switch sound on from a click (the welcome screen's Enter World): play it now, remember it,
   * and tell the speaker in the bar so it shows on.
   */
  turnOn(): void {
    sound.setEnabled(true);
    try { localStorage.setItem("gamine.sound", "1"); } catch { /* not remembered, but on */ }
    window.dispatchEvent(new Event("gamine:sound-on"));
  },

  /** A blow landing in the arena; `clash` when both charged at once. Thinned out when several fights hit together. */
  bump(clash: boolean): void {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastBump < BUMP_GAP_MS) return;
    lastBump = now;
    tone("sine", clash ? 150 : 120, 0.14, clash ? 0.5 : 0.35, 0, 55);
    burst("lowpass", clash ? 2400 : 1500, 300, clash ? 0.12 : 0.08, clash ? 0.35 : 0.22);
    if (clash) tone("square", 880 + Math.random() * 200, 0.06, 0.05, 0.005, 620);
  },

  /** A match has played out: a short rising call. A level match gets a flatter two notes. */
  fanfare(level: boolean): void {
    if (!enabled) return;
    const notes = level ? [392, 392] : [523, 659, 784];
    notes.forEach((f, i) => tone("triangle", f, i === notes.length - 1 ? 0.32 : 0.12, 0.13, i * 0.11));
  },

  /** In the lake off the dock. */
  splash(): void {
    if (!enabled) return;
    burst("bandpass", 1800, 500, 0.35, 0.3);
    tone("sine", 700, 0.12, 0.06, 0.02, 250);
  },

  /** A building or a page opened. */
  click(): void {
    if (!enabled) return;
    tone("square", 1200, 0.035, 0.05);
  },
};

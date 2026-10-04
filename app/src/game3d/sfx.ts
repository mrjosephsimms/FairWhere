// Tiny synthesized sound effects (no audio files): club thwack, putt tock, cup rattle,
// a happy jingle. Browsers only allow audio after a tap, which every shot is.
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());

function tone(freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slide?: number) {
  const a = ac(), t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur);
}

function noise(dur: number, gain: number, freq: number) {
  const a = ac(), len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = "bandpass";
  f.frequency.value = freq;
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  unlock: () => void ac().resume(),
  whoosh: () => noise(0.35, 0.25, 900),
  hit: () => (tone(1250, 0.09, "triangle", 0.4, 0, 300), noise(0.06, 0.5, 2500)),
  putt: () => tone(700, 0.08, "sine", 0.35, 0, 400),
  land: () => tone(160, 0.12, "sine", 0.3, 0, 90),
  cup: () => [0, 0.09, 0.18].forEach((at, i) => tone(1400 - i * 250, 0.12, "triangle", 0.25, at)),
  jingle: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.18, i * 0.11)),
  aww: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, "sine", 0.15, i * 0.16)),
};

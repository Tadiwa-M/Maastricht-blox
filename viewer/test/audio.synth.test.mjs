// The Web Audio voices against a recording stand-in for AudioContext: every sound builds and
// schedules without errors, ramps stay valid (exponential ramps never reach 0), short sounds stop
// themselves, and the always-on graph stays small (phones).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CitySynth } from '../src/audio/synth.js';

function fakeContext() {
  const made = { nodes: 0, sources: [] };
  const param = (v = 0) => ({
    value: v,
    setTargetAtTime(x, t, tau) { assert.ok(Number.isFinite(x) && Number.isFinite(t) && tau > 0, `setTarget ${x} ${t} ${tau}`); },
    setValueAtTime(x, t) { assert.ok(Number.isFinite(x) && t >= 0); },
    linearRampToValueAtTime(x, t) { assert.ok(Number.isFinite(x) && t >= 0); },
    exponentialRampToValueAtTime(x, t) { assert.ok(x > 0 && Number.isFinite(t), `exp ramp to ${x}`); },
  });
  const node = (extra = {}) => {
    made.nodes++;
    return { connect(n) { return n; }, disconnect() {}, ...extra };
  };
  const source = (extra) => {
    const s = node({ start(when = 0) { assert.ok(when >= 0); s.started = true; }, stop(when) { assert.ok(when >= 0); s.stopAt = when; }, ...extra });
    made.sources.push(s);
    return s;
  };
  const ac = {
    sampleRate: 8000, currentTime: 1, destination: node(), made,
    createGain: () => node({ gain: param(1) }),
    createStereoPanner: () => node({ pan: param(0) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1) }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createOscillator: () => source({ type: 'sine', frequency: param(440) }),
    createBufferSource: () => source({ buffer: null, loop: false, playbackRate: param(1) }),
    createBuffer: (ch, n, rate) => { const d = new Float32Array(n); return { duration: n / rate, getChannelData: () => d }; },
  };
  return ac;
}

const MIX = {
  traffic: { level: 0.5, pan: 0.2, cut: 400 }, crowd: { level: 0.3, pan: -0.1 }, rain: 0.4,
  engine: { level: 0.2, pan: 0, freq: 45, cut: 500 }, bells: { level: 0.3, pan: 0.5, cut: 3000 },
};

test('synth: the always-on graph is small and every voice schedules cleanly', () => {
  const ac = fakeContext();
  const s = new CitySynth(ac);
  assert.ok(ac.made.nodes < 40, `${ac.made.nodes} nodes`);
  const loops = ac.made.sources.length;
  s.setVolume(0.3);
  s.mix(MIX);
  for (const surface of ['cobble', 'stone', 'gravel', 'grass', 'nope']) s.step(surface, 1);
  s.thud('cobble', 1); s.thud('grass', 0);
  for (let q = 0; q < 20; q++) s.chirp(0.5, 1);
  s.bell(2, 233, 1, 4.5); s.bell(2, 1047, 0.4, 1.6, true);
  s.door('open'); s.door('close');
  const transient = ac.made.sources.slice(loops);
  assert.ok(transient.length > 30);
  for (const src of transient) {
    assert.ok(src.started, 'started');
    assert.ok(Number.isFinite(src.stopAt) || src.buffer, 'stops itself');
    assert.equal(typeof src.onended, 'function');
  }
  for (const src of ac.made.sources.slice(0, loops)) assert.ok(src.started && !Number.isFinite(src.stopAt)); // the beds loop
  s.resetBuses();
  s.mix(MIX);
});

test('synth: no stereo panner (old browsers) still works', () => {
  const ac = fakeContext();
  delete ac.createStereoPanner;
  const s = new CitySynth(ac);
  s.mix(MIX); s.chirp(-0.5, 1);
});

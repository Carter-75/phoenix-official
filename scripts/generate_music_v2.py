#!/usr/bin/env python3
"""Phoenix Fall music, second generation (Fix Round 1, Part 7).

Carter ordered every music track replaced with new compositions. The
first-generation tracks (generate_audio.py and generate_worldN_audio.py)
were pad and arpeggio pieces with no lead melody. This successor script
composes melody-led tracks instead: each world gets its own key, mode,
tempo, chord progression, a written lead motif (with a varied second
half), a bass line, and a light percussion layer. Nothing here reuses a
melody, progression, or arrangement from the first generation.

Output contract is unchanged: stereo, 48 kHz, 16-bit WAV files in
frontend/public/assets/audio named menu_bgm.wav, world_N_bgm.wav
(128 s; the campaign run timer reads the BGM length) and
world_N_intense_bgm.wav (30 s). Sound effects are not music and are
not touched.
"""
import math
import os

import numpy as np

SAMPLE_RATE = 48000
OUT_DIR = "frontend/public/assets/audio"
rng = np.random.default_rng(20261027)


def midi_hz(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def note(freq, seconds, wave_type="sine", volume=0.3, attack=0.01, release=0.06, vibrato=0.0):
    n = max(1, int(SAMPLE_RATE * seconds))
    t = np.linspace(0, seconds, n, endpoint=False)
    phase = 2 * np.pi * freq * t
    if vibrato:
        phase = phase + vibrato * np.sin(2 * np.pi * 5.5 * t) * (t / max(seconds, 0.01))
    if wave_type == "sine":
        v = np.sin(phase)
    elif wave_type == "triangle":
        v = 2 * np.abs(2 * ((phase / (2 * np.pi)) - np.floor(phase / (2 * np.pi) + 0.5))) - 1
    elif wave_type == "square":
        v = np.sign(np.sin(phase)) * 0.6
    elif wave_type == "saw":
        x = (phase / (2 * np.pi)) % 1.0
        v = (2 * x - 1) * 0.7
    elif wave_type == "pluck":
        v = np.sin(phase) * np.exp(-3.0 * t / max(seconds, 0.05))
    else:
        v = np.sin(phase)
    env = np.ones(n)
    a = min(int(attack * SAMPLE_RATE), n // 3)
    r = min(int(release * SAMPLE_RATE), n // 2)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if r > 0:
        env[-r:] = np.linspace(1, 0, r)
    return v * env * volume


def place(track, layer, start_s):
    start = int(start_s * SAMPLE_RATE)
    end = min(track.shape[0], start + layer.shape[0])
    if end > start:
        track[start:end] += layer[: end - start]
    return track


def kick(seconds=0.16, volume=0.5):
    n = int(SAMPLE_RATE * seconds)
    t = np.linspace(0, seconds, n, endpoint=False)
    freq = 120.0 * np.exp(-22.0 * t) + 42.0
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    return np.sin(phase) * np.exp(-16.0 * t) * volume


def hat(seconds=0.05, volume=0.12):
    n = int(SAMPLE_RATE * seconds)
    noise = rng.uniform(-1.0, 1.0, n)
    hp = np.diff(np.concatenate([[0.0], noise]))
    return hp * np.exp(-60.0 * np.linspace(0, seconds, n)) * volume


def snare(seconds=0.14, volume=0.22):
    n = int(SAMPLE_RATE * seconds)
    t = np.linspace(0, seconds, n, endpoint=False)
    noise = rng.uniform(-1.0, 1.0, n)
    body = np.sin(2 * np.pi * 190.0 * t) * 0.5
    return (noise * 0.7 + body) * np.exp(-24.0 * t) * volume


MODES = {
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "phrygian": [0, 1, 3, 5, 7, 8, 10],
    "harmonic": [0, 2, 3, 5, 7, 8, 11],
    "major": [0, 2, 4, 5, 7, 9, 11],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
    "mixolydian": [0, 2, 4, 5, 7, 9, 10],
}


def deg(root_midi, mode, degree, octave=0):
    """Scale degree (1-based, can exceed 7) to a midi note."""
    scale = MODES[mode]
    idx = degree - 1
    return root_midi + scale[idx % 7] + 12 * (idx // 7) + 12 * octave


def render(comp, seconds, intense=False):
    """comp: dict with root, mode, bpm, progression (degrees, one per
    bar), melody (list of (bar_offset_beats, len_beats, degree) with
    degree None for a rest), bass_pattern (per-bar beat offsets),
    arp_degrees, lead_wave, pad, drums level."""
    spb = 60.0 / comp["bpm"]          # seconds per beat
    bar = 4 * spb
    total = np.zeros(int(SAMPLE_RATE * seconds))
    prog = comp["progression"]
    n_bars = int(math.ceil(seconds / bar))

    # Pads: one chord per bar from the progression.
    if comp.get("pad", True):
        for b in range(n_bars):
            d = prog[b % len(prog)]
            start = b * bar
            for off in (0, 2, 4):
                f = midi_hz(deg(comp["root"], comp["mode"], d + off, octave=0))
                place(total, note(f, bar * 1.02, "triangle", 0.045, attack=bar * 0.3, release=bar * 0.3), start)
    # Bass: root of the bar chord on the pattern beats, plus the fifth
    # on the last pattern hit of every other bar.
    for b in range(n_bars):
        d = prog[b % len(prog)]
        for j, beat in enumerate(comp["bass_pattern"]):
            use = d if not (j == len(comp["bass_pattern"]) - 1 and b % 2 == 1) else d + 4
            f = midi_hz(deg(comp["root"], comp["mode"], use, octave=-1))
            place(total, note(f, spb * 0.9, "sine", 0.20, attack=0.005, release=0.08), b * bar + beat * spb)
    # Arpeggio texture: 8th notes cycling the bar chord tones.
    arp = comp.get("arp_degrees")
    if arp:
        step = spb / 2.0
        steps = int(seconds / step)
        for s in range(steps):
            b = int((s * step) // bar)
            d = prog[b % len(prog)] + arp[s % len(arp)]
            f = midi_hz(deg(comp["root"], comp["mode"], d, octave=1))
            place(total, note(f, step * 0.95, comp.get("arp_wave", "pluck"), comp.get("arp_vol", 0.05)), s * step)
    # Lead melody: two passes; the second half varies (motif shifted
    # up a fourth in degree space and the last bar resolves home).
    melody = comp["melody"]
    mel_bars = comp.get("melody_bars", 8)
    mel_len = mel_bars * bar
    passes = int(math.ceil(seconds / mel_len))
    for p in range(passes):
        shift = 0 if p % 2 == 0 else comp.get("variation_shift", 3)
        for (beat_off, len_beats, degree) in melody:
            if degree is None:
                continue
            start = p * mel_len + beat_off * spb
            if start >= seconds:
                continue
            d = degree + shift
            if p % 2 == 1 and beat_off >= (mel_bars - 1) * 4:
                d = degree  # final bar of a varied pass resolves unshifted
            f = midi_hz(deg(comp["root"], comp["mode"], d, octave=comp.get("lead_octave", 1)))
            place(total, note(f, len_beats * spb * 0.96, comp.get("lead_wave", "saw"), comp.get("lead_vol", 0.11), vibrato=0.004), start)
    # Percussion.
    drum = comp.get("drums", 0.0)
    if drum > 0:
        beats = int(seconds / spb)
        for bt in range(beats):
            place(total, kick(volume=0.34 * drum), bt * spb)
            if intense and bt % 4 == 2:
                place(total, snare(volume=0.5 * drum), bt * spb)
            if bt % 2 == 1:
                place(total, hat(volume=0.5 * drum), bt * spb)
    # Gentle stereo width and a short end fade so the file ends clean.
    delay = int(0.011 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.88
    fade = int(0.25 * SAMPLE_RATE)
    total[-fade:] *= np.linspace(1, 0, fade)
    right[-fade:] *= np.linspace(1, 0, fade)
    peak = max(np.max(np.abs(total)), np.max(np.abs(right)), 1e-6)
    gain = min(1.0, 0.85 / peak)
    return total * gain, right * gain


def write_wav(filename, left, right):
    frames = np.empty((left.shape[0], 2), dtype=np.int16)
    frames[:, 0] = np.clip(left, -1.0, 1.0) * 32767
    frames[:, 1] = np.clip(right, -1.0, 1.0) * 32767
    import wave as wave_mod
    with wave_mod.open(filename, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(frames.tobytes())
    print("wrote", filename, round(left.shape[0] / SAMPLE_RATE, 1), "s")


# ---------------------------------------------------------------------------
# Compositions. Melodies are (beat_offset, length_beats, scale_degree)
# over an 8-bar motif; degree None is a rest. Every motif, key, tempo
# and progression below is new in this generation.
# ---------------------------------------------------------------------------

WORLDS = [
    # 1 Ember Wastes: E phrygian, driving, brass-like saw lead.
    dict(root=52, mode="phrygian", bpm=112, progression=[1, 1, 6, 7],
         bass_pattern=[0, 1, 2, 3], arp_degrees=[0, 2, 4, 2], arp_wave="pluck", arp_vol=0.045,
         lead_wave="saw", lead_vol=0.10, drums=0.8, variation_shift=3,
         melody=[(0, 1, 8), (1, 1, 7), (2, 2, 5), (4, 1, 5), (5, 1, 6), (6, 2, 3),
                 (8, 2, 5), (10, 1, 3), (11, 1, 2), (12, 4, 1),
                 (16, 1, 3), (17, 1, 5), (18, 2, 8), (20, 1, 7), (21, 1, 6), (22, 2, 5),
                 (24, 1, 6), (25, 1, 5), (26, 1, 3), (27, 1, 2), (28, 4, 1)]),
    # 2 Cerulean Depths: A dorian, slow swell, sine lead with vibrato.
    dict(root=57, mode="dorian", bpm=84, progression=[1, 4, 6, 5],
         bass_pattern=[0, 2], arp_degrees=[0, 4, 2, 4], arp_wave="sine", arp_vol=0.05,
         lead_wave="sine", lead_vol=0.13, drums=0.25, variation_shift=2,
         melody=[(0, 3, 5), (3, 1, 4), (4, 4, 3), (8, 3, 4), (11, 1, 5), (12, 4, 8),
                 (16, 3, 7), (19, 1, 5), (20, 4, 4), (24, 2, 3), (26, 2, 2), (28, 4, 1)]),
    # 3 Amethyst Void: F# minor, sparse, wide leaps, triangle lead.
    dict(root=54, mode="minor", bpm=96, progression=[1, 6, 3, 7],
         bass_pattern=[0, 3], arp_degrees=[4, 2, 0, 2], arp_wave="triangle", arp_vol=0.05,
         lead_wave="triangle", lead_vol=0.12, drums=0.4, variation_shift=4,
         melody=[(0, 2, 8), (2, 2, None), (4, 2, 10), (6, 2, 8), (8, 4, 5),
                 (12, 2, 7), (14, 2, 5), (16, 2, 3), (18, 2, None), (20, 4, 5),
                 (24, 2, 4), (26, 2, 3), (28, 4, 1)]),
    # 4 Verdant Canopy: G mixolydian, bouncing pluck lead.
    dict(root=55, mode="mixolydian", bpm=120, progression=[1, 5, 4, 1],
         bass_pattern=[0, 1.5, 2, 3.5], arp_degrees=[0, 2, 4, 6], arp_wave="pluck", arp_vol=0.05,
         lead_wave="pluck", lead_vol=0.13, drums=0.7, variation_shift=3,
         melody=[(0, 0.5, 5), (0.5, 0.5, 6), (1, 1, 8), (2, 1, 6), (3, 1, 5),
                 (4, 0.5, 5), (4.5, 0.5, 4), (5, 1, 3), (6, 2, 5),
                 (8, 0.5, 8), (8.5, 0.5, 7), (9, 1, 6), (10, 1, 5), (11, 1, 4),
                 (12, 2, 3), (14, 2, 5), (16, 0.5, 5), (16.5, 0.5, 6), (17, 1, 8),
                 (18, 1, 10), (19, 1, 8), (20, 2, 6), (22, 2, 5),
                 (24, 1, 4), (25, 1, 3), (26, 1, 2), (27, 1, 3), (28, 4, 1)]),
    # 5 Ashen Reach (world 5): C harmonic minor, heavy, square lead.
    dict(root=48, mode="harmonic", bpm=100, progression=[1, 1, 4, 5],
         bass_pattern=[0, 0.5, 2, 2.5], arp_degrees=[0, 4, 2, 4], arp_wave="square", arp_vol=0.03,
         lead_wave="square", lead_vol=0.09, drums=0.9, variation_shift=2,
         melody=[(0, 1.5, 5), (1.5, 0.5, 4), (2, 2, 3), (4, 1.5, 5), (5.5, 0.5, 7), (6, 2, 8),
                 (8, 3, 7), (11, 1, 5), (12, 4, 3),
                 (16, 1.5, 8), (17.5, 0.5, 7), (18, 2, 5), (20, 1.5, 4), (21.5, 0.5, 3), (22, 2, 2),
                 (24, 2, 3), (26, 2, 5), (28, 4, 1)]),
    # 6 Frostspire (world 6): D lydian, bright, triangle lead.
    dict(root=50, mode="lydian", bpm=104, progression=[1, 2, 6, 5],
         bass_pattern=[0, 2, 3], arp_degrees=[0, 2, 4, 6, 4, 2], arp_wave="triangle", arp_vol=0.05,
         lead_wave="triangle", lead_vol=0.12, drums=0.5, variation_shift=3,
         melody=[(0, 2, 5), (2, 1, 6), (3, 1, 8), (4, 2, 9), (6, 2, 8),
                 (8, 2, 6), (10, 2, 5), (12, 4, 4),
                 (16, 2, 8), (18, 1, 9), (19, 1, 11), (20, 2, 9), (22, 2, 8),
                 (24, 1, 6), (25, 1, 5), (26, 1, 4), (27, 1, 3), (28, 4, 1)]),
    # 7 Drowned Ruins (world 7): B minor, hymn-like, sine lead.
    dict(root=47, mode="minor", bpm=76, progression=[1, 3, 6, 4],
         bass_pattern=[0, 2], arp_degrees=[0, 2, 4, 2], arp_wave="sine", arp_vol=0.045,
         lead_wave="sine", lead_vol=0.13, drums=0.2, variation_shift=2,
         melody=[(0, 4, 3), (4, 4, 5), (8, 4, 8), (12, 4, 7),
                 (16, 4, 5), (20, 4, 4), (24, 4, 2), (28, 4, 1)]),
    # 8 Stormforge (world 8): A phrygian, galloping bass, saw lead.
    dict(root=57, mode="phrygian", bpm=132, progression=[1, 2, 1, 7],
         bass_pattern=[0, 0.5, 1, 2, 2.5, 3], arp_degrees=[0, 4, 2, 4], arp_wave="saw", arp_vol=0.03,
         lead_wave="saw", lead_vol=0.10, drums=1.0, variation_shift=3,
         melody=[(0, 1, 8), (1, 0.5, 7), (1.5, 0.5, 8), (2, 2, 5), (4, 1, 6), (5, 1, 5), (6, 2, 3),
                 (8, 1, 5), (9, 0.5, 6), (9.5, 0.5, 5), (10, 2, 8), (12, 4, 7),
                 (16, 1, 8), (17, 1, 10), (18, 2, 8), (20, 1, 7), (21, 1, 6), (22, 2, 5),
                 (24, 2, 3), (26, 2, 2), (28, 4, 1)]),
    # 9 Hollow Sun (world 9): Eb major, stately, triangle lead.
    dict(root=51, mode="major", bpm=92, progression=[1, 5, 6, 4],
         bass_pattern=[0, 2, 3], arp_degrees=[0, 2, 4, 2], arp_wave="triangle", arp_vol=0.05,
         lead_wave="triangle", lead_vol=0.12, drums=0.45, variation_shift=4,
         melody=[(0, 2, 3), (2, 2, 5), (4, 3, 8), (7, 1, 7), (8, 4, 5),
                 (12, 2, 6), (14, 2, 5), (16, 2, 4), (18, 2, 5), (20, 4, 8),
                 (24, 2, 7), (26, 2, 6), (28, 4, 5), (30, 2, None), (30, 0.5, 3), (30.5, 0.5, 2), (31, 1, 1)]),
    # 10 The First Flame (world 10): E harmonic minor, fastest, square lead.
    dict(root=52, mode="harmonic", bpm=140, progression=[1, 6, 4, 5],
         bass_pattern=[0, 1, 2, 3], arp_degrees=[0, 2, 4, 6], arp_wave="square", arp_vol=0.03,
         lead_wave="square", lead_vol=0.09, drums=1.0, variation_shift=3,
         melody=[(0, 0.5, 8), (0.5, 0.5, 7), (1, 1, 5), (2, 1, 7), (3, 1, 8),
                 (4, 0.5, 10), (4.5, 0.5, 8), (5, 1, 7), (6, 2, 5),
                 (8, 0.5, 5), (8.5, 0.5, 7), (9, 1, 8), (10, 1, 7), (11, 1, 5),
                 (12, 2, 4), (14, 2, 3), (16, 0.5, 8), (16.5, 0.5, 10), (17, 1, 11),
                 (18, 1, 10), (19, 1, 8), (20, 2, 7), (22, 2, 5),
                 (24, 1, 4), (25, 1, 5), (26, 1, 7), (27, 1, 8), (28, 4, 8)]),
]

MENU = dict(root=50, mode="dorian", bpm=88, progression=[1, 6, 4, 5],
            bass_pattern=[0, 2], arp_degrees=[0, 2, 4, 2], arp_wave="triangle", arp_vol=0.05,
            lead_wave="sine", lead_vol=0.12, drums=0.3, variation_shift=2,
            melody=[(0, 2, 5), (2, 2, 8), (4, 2, 7), (6, 2, 5), (8, 4, 4),
                    (12, 2, 5), (14, 2, 3), (16, 2, 5), (18, 2, 8), (20, 2, 10), (22, 2, 8),
                    (24, 2, 7), (26, 2, 5), (28, 4, 1)])


def intense_variant(comp):
    """The intense cut of a world: same key, new faster motif built from
    a driving octave pulse plus the world's degrees re-cut in 16ths.
    It is a separate composition, not the BGM sped up."""
    c = dict(comp)
    c["bpm"] = min(168, int(comp["bpm"] * 1.3) + 8)
    c["bass_pattern"] = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
    c["drums"] = 1.0
    c["melody_bars"] = 4
    base = [d for (_, _, d) in comp["melody"] if d is not None][:8]
    mel = []
    beat = 0.0
    seq = base + base[::-1]
    for d in seq:
        mel.append((beat, 0.5, d))
        mel.append((beat + 0.5, 0.5, d))
        beat += 1.0
    mel.append((15.0, 1.0, base[0]))
    c["melody"] = mel
    return c


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = render(MENU, 128.0)
    write_wav(f"{OUT_DIR}/menu_bgm.wav", left, right)
    for i, comp in enumerate(WORLDS):
        left, right = render(comp, 128.0)
        write_wav(f"{OUT_DIR}/world_{i + 1}_bgm.wav", left, right)
        left, right = render(intense_variant(comp), 30.0, intense=True)
        write_wav(f"{OUT_DIR}/world_{i + 1}_intense_bgm.wav", left, right)

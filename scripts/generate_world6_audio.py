#!/usr/bin/env python3
"""Generate the World 6 (Crystal Caverns) music: world_6_bgm.wav
and world_6_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: where the
Amethyst Void is crystalline and suspended in A minor, the Caverns
are crystalline and deep in D major, sine arpeggios ringing in a
cavern echo (each figure repeated softer and later, the way sound
comes back off crystal walls) over a low resonant pad.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Crystal arp in D major: D3 F#3 A3 C#4 A3 F#3, struck notes
    # 0.55 s apart with long releases.
    arp_notes = [146.83, 185.0, 220.0, 277.18, 220.0, 185.0]
    note_dur = 0.55
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    figure = sequence(arp, "sine", 0.115, attack=0.005, release=0.42)
    total = mix_into(total, figure)
    # Cavern echoes: the same figure twice more, later and softer.
    total = mix_into(total, figure * 0.45, note_dur * 3)
    total = mix_into(total, figure * 0.22, note_dur * 6)
    # Resonant pad: D2 / A2 / B2 / F#3 roots, one per 16 seconds.
    roots = [73.42, 110.0, 123.47, 185.0]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.055), i * 16.0)
    # Deep drip pings: deterministic low crystal strikes, sparse.
    rng = np.random.default_rng(6)
    t = 4.0
    while t < seconds - 3:
        f = float(rng.choice([880.0, 1108.73, 1318.51]))
        total = mix_into(total, tone(f, 1.4, "sine", 0.026, attack=0.002, release=1.3), t)
        t += 5.0 + float(rng.uniform(0.0, 4.0))
    delay = int(0.015 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass D1/D2 alternating, 8ths.
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((36.71 if i % 2 == 0 else 73.42, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.095))
    # Urgent crystal arp in D, bright and fast.
    arp_notes = [293.66, 369.99, 440.0, 554.37]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    figure = sequence(arp, "sine", 0.11, attack=0.003, release=0.15)
    total = mix_into(total, figure)
    total = mix_into(total, figure * 0.4, 0.6)
    # Shard pings on the off-beats.
    rng = np.random.default_rng(11)
    t = 0.1
    while t < seconds - 1:
        f = float(rng.choice([1760.0, 2217.46, 2637.02]))
        total = mix_into(total, tone(f, 0.5, "sine", 0.028, attack=0.002, release=0.45), t)
        t += 0.5
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_6_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_6_intense_bgm.wav", left, right)

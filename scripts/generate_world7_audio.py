#!/usr/bin/env python3
"""Generate the World 7 (Neon Nebula) music: world_7_bgm.wav and
world_7_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: a frozen
nebula under an aurora. Where Amethyst Void is crystalline in A
minor and Crystal Caverns ring deep in D major, Neon Nebula hangs
high and icy in E major: a slow glass arp of high sine bells with
very long releases, a detuned pad breathing far below, and sparse
ice pings that fall like light through snow.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Glass arp in E major, high register: E5 G#5 B5 E6 B5 G#5,
    # struck notes 0.8 s apart with long releases so the bells hang
    # in the cold air and overlap.
    arp_notes = [659.25, 830.61, 987.77, 1318.51, 987.77, 830.61]
    note_dur = 0.8
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    figure = sequence(arp, "sine", 0.085, attack=0.004, release=0.7)
    total = mix_into(total, figure)
    # A breath of the same figure an octave down, much softer and
    # offset, like the aurora answering itself.
    total = mix_into(total, figure * 0.30, note_dur * 2)
    # Nebula pad: E2 / B2 / G#2 / C#3 roots, one per 16 seconds.
    roots = [82.41, 123.47, 103.83, 138.59]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.05), i * 16.0)
    # Ice pings: sparse, very high, deterministic placement.
    rng = np.random.default_rng(7)
    t = 3.0
    while t < seconds - 3:
        f = float(rng.choice([2637.02, 3135.96, 3520.0, 3951.07]))
        total = mix_into(total, tone(f, 1.6, "sine", 0.02, attack=0.002, release=1.5), t)
        t += 4.0 + float(rng.uniform(0.0, 4.0))
    delay = int(0.015 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass E1/E2 alternating, 8ths.
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((41.20 if i % 2 == 0 else 82.41, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.09))
    # Urgent ice arp in E, bright and fast.
    arp_notes = [659.25, 830.61, 987.77, 1318.51]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    figure = sequence(arp, "sine", 0.10, attack=0.003, release=0.16)
    total = mix_into(total, figure)
    total = mix_into(total, figure * 0.4, 0.6)
    # Shard pings on the off-beats.
    rng = np.random.default_rng(17)
    t = 0.1
    while t < seconds - 1:
        f = float(rng.choice([2637.02, 3135.96, 3951.07]))
        total = mix_into(total, tone(f, 0.5, "sine", 0.024, attack=0.002, release=0.45), t)
        t += 0.5
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_7_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_7_intense_bgm.wav", left, right)

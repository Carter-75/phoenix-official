#!/usr/bin/env python3
"""Generate the World 10 (Abyssal Rift) music: world_10_bgm.wav
and world_10_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: divine
light in a black sky. A slow ascending arp in C major add9 rings
over stacked radiant pads (root and fifth pads layered, so the
harmony itself glows), with high shimmer pings for starlight. The
finale's music is the brightest in the game, the mirror of the
darkest world.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Ascending arp in C major add9: C4 E4 G4 D5 E5 G5, struck
    # notes 0.7 s apart with long releases, always climbing home.
    arp_notes = [261.63, 329.63, 392.0, 587.33, 659.25, 783.99]
    note_dur = 0.7
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    figure = sequence(arp, "sine", 0.10, attack=0.005, release=0.55)
    total = mix_into(total, figure)
    # Octave echo, quiet: light answering light.
    total = mix_into(total, figure * 0.30, note_dur)
    # Radiant pads, stacked: each 16 second root carries its fifth
    # as a second pad, so the chords arrive already glowing.
    # Roots walk C / G / A / F, the eternal progression.
    roots = [65.41, 98.0, 110.0, 87.31]
    for i in range(seconds // 16):
        root = roots[i % len(roots)]
        total = mix_into(total, pad(root, 16.0, 0.05), i * 16.0)
        total = mix_into(total, pad(root * 1.5, 16.0, 0.032), i * 16.0)
    # Starlight pings: sparse and very high, deterministic.
    rng = np.random.default_rng(10)
    t = 2.0
    while t < seconds - 3:
        f = float(rng.choice([2093.0, 2637.02, 3135.96, 3520.0]))
        total = mix_into(total, tone(f, 1.5, "sine", 0.022, attack=0.002, release=1.4), t)
        t += 3.5 + float(rng.uniform(0.0, 3.5))
    delay = int(0.015 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass C1/C2 alternating, 8ths.
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((32.70 if i % 2 == 0 else 65.41, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.09))
    # Radiant fast arp in C, climbing figures.
    arp_notes = [523.25, 659.25, 783.99, 1046.5]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    figure = sequence(arp, "sine", 0.105, attack=0.003, release=0.15)
    total = mix_into(total, figure)
    total = mix_into(total, figure * 0.4, 0.6)
    # Starlight pings on the off-beats.
    rng = np.random.default_rng(20)
    t = 0.1
    while t < seconds - 1:
        f = float(rng.choice([2093.0, 2637.02, 3135.96]))
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
    write_wav(f"{OUT_DIR}/world_10_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_10_intense_bgm.wav", left, right)

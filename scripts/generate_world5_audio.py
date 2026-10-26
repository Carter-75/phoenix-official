#!/usr/bin/env python3
"""Generate the World 5 (Ashen Peaks) music: world_5_bgm.wav and
world_5_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: the one
desaturated world gets a sparse, gray track to match. Low sine
drones and a slow E minor pad under rare struck notes with long
releases, and a band of slow wind noise breathing underneath
everything, quieter than any note.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def wind(seconds, volume=0.016):
    # Slowly breathing noise: white noise through a heavy moving
    # average (a poor man's lowpass), amplitude wandering on a
    # 20 second cycle. Deterministic via the fixed seed.
    rng = np.random.default_rng(5)
    n = int(SAMPLE_RATE * seconds)
    noise = rng.standard_normal(n)
    kernel = 400
    smooth = np.convolve(noise, np.ones(kernel) / kernel, mode="same")
    t = np.linspace(0, seconds, n, endpoint=False)
    breath = 0.6 + 0.4 * np.sin(2 * np.pi * t / 20.0)
    env = np.minimum(1.0, np.minimum(t / 3.0, (seconds - t) / 3.0))
    return smooth * breath * env * volume * 8.0


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Struck notes in E minor, sparse: E3 G3 B3 E4, one every 3.2
    # seconds, each ringing out almost to the next.
    struck = [164.81, 196.0, 246.94, 329.63, 246.94, 196.0]
    note_dur = 3.2
    notes = []
    reps = int(seconds / (note_dur * len(struck))) + 1
    for _ in range(reps):
        for f in struck:
            notes.append((f, note_dur))
    total = mix_into(total, sequence(notes, "triangle", 0.085, attack=0.006, release=2.6))
    # Ash pad: E2 / B2 / G2 / B2 roots, one per 16 seconds, darker
    # and slower than the other worlds' pads.
    roots = [82.41, 123.47, 98.0, 123.47]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.06), i * 16.0)
    # A low drone root under the whole track, barely present.
    total = mix_into(total, pad(41.20, float(seconds), 0.035))
    # The wind band, under everything.
    total = mix_into(total, wind(seconds))
    delay = int(0.016 * SAMPLE_RATE)
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
    # Minor arp, slower and heavier than the other intense tracks:
    # the storm here is weight, not speed.
    arp_notes = [329.63, 392.0, 493.88, 659.25]
    arp = []
    for i in range(int(seconds / 0.3)):
        arp.append((arp_notes[i % len(arp_notes)], 0.3))
    total = mix_into(total, sequence(arp, "triangle", 0.10, attack=0.004, release=0.22))
    # The wind rises with the fight.
    total = mix_into(total, wind(seconds, volume=0.024))
    delay = int(0.010 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_5_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_5_intense_bgm.wav", left, right)

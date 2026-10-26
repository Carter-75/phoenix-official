#!/usr/bin/env python3
"""Generate the World 9 (Blood Moon) music: world_9_bgm.wav and
world_9_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: dread in D
minor. Slow tolling sine bells with very long releases over a dark
detuned pad, and a low double-thump far underneath, the moon's
heartbeat, quiet enough to feel rather than hear.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Tolling bells in D minor: sparse struck notes, one every
    # 2.4 s in a falling figure, ringing long into each other.
    bells = [146.83, 220.0, 174.61, 146.83, 130.81, 174.61, 196.0, 146.83]
    note_dur = 2.4
    seq = []
    reps = int(seconds / (note_dur * len(bells))) + 1
    for _ in range(reps):
        for f in bells:
            seq.append((f, note_dur))
    total = mix_into(total, sequence(seq, "sine", 0.13, attack=0.006, release=2.2))
    # A quiet fifth-up shimmer on each toll, delayed half a beat:
    # the bell's cold overtone.
    total = mix_into(total, sequence(seq, "sine", 0.03, attack=0.006, release=2.0), note_dur * 0.5)
    # Dark pad: D2 / Bb1 / F2 / A2 roots, one per 16 seconds.
    roots = [73.42, 58.27, 87.31, 110.0]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.06), i * 16.0)
    # The moon's heartbeat: a low double-thump every 8 seconds,
    # deep and quiet.
    t = 2.0
    while t < seconds - 2:
        total = mix_into(total, tone(55.0, 0.30, "sine", 0.11, attack=0.005, release=0.26), t)
        total = mix_into(total, tone(55.0, 0.26, "sine", 0.08, attack=0.005, release=0.22), t + 0.42)
        t += 8.0
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
    # Urgent minor arp in D, falling figures.
    arp_notes = [587.33, 440.0, 349.23, 293.66]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    figure = sequence(arp, "sine", 0.11, attack=0.003, release=0.15)
    total = mix_into(total, figure)
    total = mix_into(total, figure * 0.4, 0.6)
    # The heartbeat quickens with the fight: every 2 seconds.
    t = 0.0
    while t < seconds - 1:
        total = mix_into(total, tone(55.0, 0.24, "sine", 0.10, attack=0.005, release=0.2), t)
        total = mix_into(total, tone(55.0, 0.2, "sine", 0.07, attack=0.005, release=0.17), t + 0.3)
        t += 2.0
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_9_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_9_intense_bgm.wav", left, right)

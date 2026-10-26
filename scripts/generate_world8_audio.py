#!/usr/bin/env python3
"""Generate the World 8 (Golden Sands) music: world_8_bgm.wav and
world_8_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (128 seconds for the
normal track, which the campaign uses as the run timer; 30 seconds
for the intense track). The voicing is the world's own: ancient
desert. A plucked triangle arp walks a D hijaz scale (the flattened
second and raised third are the Emperor's antiquity), low sine
drops beat a slow frame-drum pattern underneath, and a deep drone
pad holds the heat.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into

# D hijaz: D, Eb, F#, G, A, Bb, C.
HIJAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33]


def drum_drop(freq, seconds=0.22, volume=0.20):
    # A low sine burst with a fast fall: the frame drum's voice in
    # this generator's vocabulary (tone() with a short release).
    return tone(freq, seconds, "sine", volume, attack=0.004, release=seconds * 0.8)


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Plucked arp walking the hijaz scale up and back down, notes
    # 0.5 s apart, dry triangle plucks with a short ring.
    walk = [0, 2, 4, 5, 7, 5, 4, 2, 1, 2, 4, 3]
    note_dur = 0.5
    arp = []
    reps = int(seconds / (note_dur * len(walk))) + 1
    for _ in range(reps):
        for k in walk:
            arp.append((HIJAZ[k], note_dur))
    figure = sequence(arp, "triangle", 0.11, attack=0.004, release=0.30)
    total = mix_into(total, figure)
    # Frame drum: a deep thump on the bar and a lighter knock off
    # it, every 2 seconds, deterministic.
    t = 0.0
    while t < seconds - 1:
        total = mix_into(total, drum_drop(98.0, 0.22, 0.20), t)
        total = mix_into(total, drum_drop(146.83, 0.14, 0.10), t + 0.75)
        total = mix_into(total, drum_drop(98.0, 0.22, 0.16), t + 1.5)
        t += 2.0
    # Drone pad: D2 / A2 / G2 / F2 roots, one per 16 seconds.
    roots = [73.42, 110.0, 98.0, 87.31]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.055), i * 16.0)
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
    # The drum pattern doubles its pace.
    t = 0.0
    while t < seconds - 1:
        total = mix_into(total, drum_drop(98.0, 0.2, 0.18), t)
        total = mix_into(total, drum_drop(146.83, 0.12, 0.09), t + 0.5)
        t += 1.0
    # Urgent hijaz arp, fast.
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((HIJAZ[[0, 2, 4, 7, 4, 2][i % 6]], 0.2))
    figure = sequence(arp, "triangle", 0.105, attack=0.003, release=0.14)
    total = mix_into(total, figure)
    total = mix_into(total, figure * 0.4, 0.6)
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_8_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_8_intense_bgm.wav", left, right)

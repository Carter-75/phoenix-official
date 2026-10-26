#!/usr/bin/env python3
"""Generate the World 4 (Verdant Canopy) music: world_4_bgm.wav and
world_4_intense_bgm.wav.

Follows the pattern of generate_world3_audio.py: same shipped
format (stereo, 48 kHz, 16-bit), same lengths (the campaign uses
the BGM length as the run timer, so the normal track is 128
seconds like Worlds 1 to 3; the intense track is 30 seconds). The
voicing is the world's own: a living canopy, plucked triangle
arpeggios in G major over a warm pad, with sparse bird-like chirps
placed deterministically in the gaps. Brighter and busier than the
worlds before it, the way the canopy is brighter than the depths.
"""
import numpy as np

from generate_world3_audio import SAMPLE_RATE, OUT_DIR, write_wav, tone, pad, sequence, mix_into


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Plucked arp in G major: G3 B3 D4 E4 D4 B3, quick struck notes
    # (0.4 s apart) with short releases, a marimba-like figure.
    arp_notes = [196.0, 246.94, 293.66, 329.63, 293.66, 246.94]
    note_dur = 0.4
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    total = mix_into(total, sequence(arp, "triangle", 0.11, attack=0.004, release=0.22))
    # A soft octave echo answering a beat later, like a second bird.
    echo = []
    for _ in range(reps):
        for f in arp_notes:
            echo.append((f * 2, note_dur))
    total = mix_into(total, sequence(echo, "sine", 0.03, attack=0.004, release=0.2), note_dur * 2)
    # Canopy pad: G2 / C3 / D3 / E3 roots, one per 16 seconds.
    roots = [98.0, 130.81, 146.83, 164.81]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.05), i * 16.0)
    # Bird chirps: deterministic pairs of quick descending sine
    # blips, high and quiet, scattered through the track.
    rng = np.random.default_rng(4)
    t = 3.0
    while t < seconds - 3:
        f0 = float(rng.choice([2637.02, 2960.0, 3322.44, 3520.0]))
        for k in range(2):
            blip = tone(f0 * (1.0 - 0.12 * k), 0.14, "sine", 0.020, attack=0.003, release=0.10)
            total = mix_into(total, blip, t + k * 0.22)
        t += 4.0 + float(rng.uniform(0.0, 4.0))
    # Gentle stereo width: right channel delayed 12 ms, softer.
    delay = int(0.012 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass G1/G2 alternating, 8ths.
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((49.0 if i % 2 == 0 else 98.0, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.09))
    # Urgent canopy arp, faster and higher than the calm track.
    arp_notes = [392.0, 493.88, 587.33, 783.99]
    arp = []
    for i in range(int(seconds / 0.18)):
        arp.append((arp_notes[i % len(arp_notes)], 0.18))
    total = mix_into(total, sequence(arp, "triangle", 0.11, attack=0.003, release=0.12))
    # Alarm chirps on the off-beats.
    rng = np.random.default_rng(9)
    t = 0.2
    while t < seconds - 1:
        f = float(rng.choice([2960.0, 3520.0]))
        total = mix_into(total, tone(f, 0.3, "sine", 0.022, attack=0.002, release=0.26), t)
        t += 0.75
    delay = int(0.008 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_4_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_4_intense_bgm.wav", left, right)

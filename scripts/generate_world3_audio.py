#!/usr/bin/env python3
"""Generate the World 3 (Amethyst Void) music: world_3_bgm.wav and
world_3_intense_bgm.wav.

Follows the pattern of generate_world2_audio.py: same shipped format
(stereo, 48 kHz, 16-bit), same lengths (the campaign uses the BGM
length as the run timer, so the normal track is 128 seconds like
Worlds 1 and 2; the intense track is 30 seconds). The voicing is the
world's own: crystalline sine arpeggios with long releases over a
slow detuned nebula pad, sparse and suspended, where Worlds 1 and 2
are warm and wet. A minor throughout, the Crystal Titan's key.
"""
import math
import os
import struct
import wave

import numpy as np

SAMPLE_RATE = 48000
OUT_DIR = "frontend/public/assets/audio"


def write_wav(filename, left, right):
    frames = np.empty((left.shape[0], 2), dtype=np.int16)
    frames[:, 0] = np.clip(left, -1.0, 1.0) * 32767
    frames[:, 1] = np.clip(right, -1.0, 1.0) * 32767
    with wave.open(filename, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(frames.tobytes())
    print("wrote", filename, round(left.shape[0] / SAMPLE_RATE, 1), "s")


def tone(freq, seconds, wave_type="sine", volume=0.3, attack=0.01, release=0.05):
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    if wave_type == "sine":
        v = np.sin(2 * np.pi * freq * t)
    elif wave_type == "triangle":
        v = 2 * np.abs(2 * (freq * t - np.floor(freq * t + 0.5))) - 1
    elif wave_type == "square":
        v = np.sign(np.sin(2 * np.pi * freq * t))
    else:
        v = np.sin(2 * np.pi * freq * t)
    # attack/release envelope per note (crystal notes ring out longer)
    n = v.shape[0]
    env = np.ones(n)
    a = min(int(attack * SAMPLE_RATE), n // 4)
    r = min(int(release * SAMPLE_RATE), n // 2)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if r > 0:
        env[-r:] = np.linspace(1, 0, r)
    return v * env * volume


def pad(freq, seconds, volume=0.05):
    # Two detuned sines beating slowly against each other: the nebula.
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    v = np.sin(2 * np.pi * freq * t) + 0.6 * np.sin(2 * np.pi * freq * 1.003 * t)
    env = np.minimum(1.0, np.minimum(t / 2.0, (seconds - t) / 2.0))
    return v * env * volume


def sequence(notes, wave_type="sine", volume=0.3, attack=0.01, release=0.05):
    parts = [tone(f, d, wave_type, volume, attack, release) for f, d in notes]
    return np.concatenate(parts) if parts else np.zeros(1)


def mix_into(track, layer, start_s=0.0):
    start = int(start_s * SAMPLE_RATE)
    end = min(track.shape[0], start + layer.shape[0])
    if end > start:
        track[start:end] += layer[: end - start]
    return track


def world_bgm():
    seconds = 128
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Crystalline arp in A minor: A3 C4 E4 B4 E4 C4, slow struck notes
    # (0.6 s apart) with long releases so each note rings into the next.
    arp_notes = [220.0, 261.63, 329.63, 493.88, 329.63, 261.63]
    note_dur = 0.6
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    total = mix_into(total, sequence(arp, "sine", 0.13, attack=0.005, release=0.45))
    # A quiet octave-up echo of the same figure, offset by one note:
    # facets catching the light.
    echo = []
    for _ in range(reps):
        for f in arp_notes:
            echo.append((f * 2, note_dur))
    total = mix_into(total, sequence(echo, "sine", 0.035, attack=0.005, release=0.4), note_dur)
    # Nebula pad: A2 / F2 / C3 / E3 roots, one per 16 seconds.
    roots = [110.0, 87.31, 130.81, 164.81]
    for i in range(seconds // 16):
        total = mix_into(total, pad(roots[i % len(roots)], 16.0, 0.055), i * 16.0)
    # Sparse shimmer pings, deterministic placement (a struck crystal
    # every few seconds, high and quiet).
    rng = np.random.default_rng(3)
    t = 2.0
    while t < seconds - 2:
        f = float(rng.choice([1760.0, 2217.46, 2637.02, 3520.0]))
        total = mix_into(total, tone(f, 1.2, "sine", 0.028, attack=0.002, release=1.1), t)
        t += 3.0 + float(rng.uniform(0.0, 3.0))
    # Gentle stereo width: right channel delayed 14 ms, softer.
    delay = int(0.014 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass A1/A2 alternating, 8ths.
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((55.0 if i % 2 == 0 else 110.0, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.10))
    # Urgent crystal arp, faster and brighter than the calm track.
    arp_notes = [440.0, 523.25, 659.25, 987.77]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    total = mix_into(total, sequence(arp, "sine", 0.12, attack=0.003, release=0.16))
    # Shard pings on the off-beats.
    rng = np.random.default_rng(7)
    t = 0.1
    while t < seconds - 1:
        f = float(rng.choice([1760.0, 2637.02, 3520.0]))
        total = mix_into(total, tone(f, 0.5, "sine", 0.03, attack=0.002, release=0.45), t)
        t += 0.5
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_3_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_3_intense_bgm.wav", left, right)

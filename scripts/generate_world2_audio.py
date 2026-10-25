#!/usr/bin/env python3
"""Generate the World 2 (Cerulean Depths) music that audit bug 3 found
missing: world_2_bgm.wav and world_2_intense_bgm.wav.

Matches the shipped format of the world 1 tracks (stereo, 48 kHz, 16-bit).
World 1's normal track runs about 128 seconds because the campaign uses the
BGM length as the run timer: the boss spawns when the world BGM ends. The
world 2 normal track is the same length so pacing stays consistent.
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


def tone(freq, seconds, wave_type="sine", volume=0.3):
    t = np.linspace(0, seconds, int(SAMPLE_RATE * seconds), endpoint=False)
    if wave_type == "sine":
        v = np.sin(2 * np.pi * freq * t)
    elif wave_type == "triangle":
        v = 2 * np.abs(2 * (freq * t - np.floor(freq * t + 0.5))) - 1
    elif wave_type == "square":
        v = np.sign(np.sin(2 * np.pi * freq * t))
    else:
        v = np.sin(2 * np.pi * freq * t)
    # short attack/release envelope per note
    n = v.shape[0]
    env = np.ones(n)
    a = min(int(0.01 * SAMPLE_RATE), n // 4)
    r = min(int(0.05 * SAMPLE_RATE), n // 2)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if r > 0:
        env[-r:] = np.linspace(1, 0, r)
    return v * env * volume


def sequence(notes, wave_type="sine", volume=0.3):
    parts = [tone(f, d, wave_type, volume) for f, d in notes]
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
    # D minor underwater arp: D3 F3 A3 C4 A3 F3, eighth notes at 100 BPM feel
    arp_notes = [146.83, 174.61, 220.0, 261.63, 220.0, 174.61]
    note_dur = 0.3
    arp = []
    reps = int(seconds / (note_dur * len(arp_notes))) + 1
    for _ in range(reps):
        for f in arp_notes:
            arp.append((f, note_dur))
    total = mix_into(total, sequence(arp, "triangle", 0.16))
    # Slow sub bass: D2 / Bb1 / F2 / C2, one chord root per 8 seconds
    roots = [73.42, 58.27, 87.31, 65.41]
    for i in range(seconds // 8):
        total = mix_into(total, tone(roots[i % len(roots)], 8.0, "sine", 0.22), i * 8.0)
    # Gentle stereo width: right channel is the same mix delayed 12ms, softer
    delay = int(0.012 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


def intense_bgm():
    seconds = 30
    total = np.zeros(int(SAMPLE_RATE * seconds))
    # Driving pulse bass D2/F2 alternating, 8ths at a faster clip
    pulse = []
    for i in range(int(seconds / 0.25)):
        pulse.append((73.42 if i % 2 == 0 else 87.31, 0.25))
    total = mix_into(total, sequence(pulse, "square", 0.12))
    # Higher urgent arp
    arp_notes = [293.66, 349.23, 440.0, 523.25]
    arp = []
    for i in range(int(seconds / 0.2)):
        arp.append((arp_notes[i % len(arp_notes)], 0.2))
    total = mix_into(total, sequence(arp, "triangle", 0.14))
    delay = int(0.009 * SAMPLE_RATE)
    right = np.zeros_like(total)
    right[delay:] = total[:-delay] * 0.85
    return total * 0.9, right * 0.9


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    left, right = world_bgm()
    write_wav(f"{OUT_DIR}/world_2_bgm.wav", left, right)
    left, right = intense_bgm()
    write_wav(f"{OUT_DIR}/world_2_intense_bgm.wav", left, right)

import wave, math, struct, os, random
random.seed(7)
OUT = os.path.expanduser('~/workspace/phoenix-official/assets/audio')
os.makedirs(OUT, exist_ok=True)
SR = 22050

def write_wav(name, samples):
    path = os.path.join(OUT, name)
    with wave.open(path, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        frames = b''.join(struct.pack('<h', max(-32767, min(32767, int(s * 32767)))) for s in samples)
        w.writeframes(frames)
    print(name, len(samples)/SR, 's')

def tone(freq_a, freq_b, dur, vol=0.5, wave_type='sine'):
    n = int(SR * dur); out = []
    for i in range(n):
        t = i / SR; f = freq_a + (freq_b - freq_a) * (i / n)
        ph = 2 * math.pi * f * t
        v = math.sin(ph) if wave_type == 'sine' else (1 if math.sin(ph) >= 0 else -1) * 0.6
        env = 1 - (i / n)
        out.append(v * vol * env * env)
    return out

def noise_burst(dur, vol=0.6, decay=3.0):
    n = int(SR * dur); return [random.uniform(-1, 1) * vol * math.exp(-decay * i / n) for i in range(n)]

def mix(*tracks):
    L = max(len(t) for t in tracks); out = [0.0]*L
    for t in tracks:
        for i, s in enumerate(t): out[i] += s
    m = max(1e-9, max(abs(x) for x in out))
    return [x / m * 0.9 if m > 0.9 else x for x in out]

def seq(*parts):
    out = []
    for p in parts: out.extend(p)
    return out

write_wav('shoot.wav', tone(880, 440, 0.12, 0.35, 'square'))
write_wav('hit.wav', noise_burst(0.08, 0.4))
write_wav('explosion.wav', mix(noise_burst(0.5, 0.9, 2.0), tone(160, 40, 0.5, 0.7)))
write_wav('player_hit.wav', tone(220, 90, 0.25, 0.6, 'square'))
write_wav('coin.wav', seq(tone(1320, 1320, 0.06, 0.3), tone(1760, 1760, 0.12, 0.3)))
write_wav('click.wav', tone(660, 660, 0.05, 0.25))
write_wav('levelup.wav', seq(*[tone(f, f, 0.11, 0.4) for f in (523, 659, 784, 1047)]))
write_wav('boss.wav', mix(tone(98, 98, 0.8, 0.7), tone(147, 147, 0.8, 0.5), tone(196, 190, 0.8, 0.4)))
write_wav('revive.wav', seq(*[tone(f, f, 0.1, 0.35) for f in (392, 523, 659, 784, 1047, 1319)]))
write_wav('beam.wav', tone(1400, 700, 0.3, 0.3, 'square'))
# Looping background pad: warm minor chord wash, 16 seconds, loop-friendly crossfade ends
dur = 16.0; n = int(SR * dur); samples = []
chords = [(220.0, 261.63, 329.63), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66), (164.81, 196.0, 246.94)]
for i in range(n):
    t = i / SR; seg = int(t // 4) % 4; local = (t % 4) / 4
    chord = chords[seg]; nxt = chords[(seg + 1) % 4]
    v = 0.0
    for j, f in enumerate(chord):
        fade = local
        v += math.sin(2 * math.pi * f * t) * 0.12 * (1 - fade * 0.4)
        v += math.sin(2 * math.pi * nxt[j] * t) * 0.12 * (fade * 0.4)
    env = min(1.0, i / (SR * 0.5), (n - i) / (SR * 0.5))
    samples.append(v * env * 0.8)
write_wav('music.wav', samples)

import math, wave, struct
import os

SAMPLE_RATE = 44100

def make_wav(filename, samples):
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        for s in samples:
            # clip
            s = max(-1.0, min(1.0, s))
            wav_file.writeframes(struct.pack('h', int(s * 32767.0)))

def generate_click():
    # A short, smooth click (sine wave with fast exponential decay)
    samples = []
    duration = 0.05
    freq = 800.0
    for i in range(int(SAMPLE_RATE * duration)):
        t = i / SAMPLE_RATE
        envelope = math.exp(-t * 80) # very fast decay
        s = math.sin(2 * math.pi * freq * t) * envelope * 0.5
        samples.append(s)
    return samples

def generate_buy():
    # A soft, upgraded "purchase" double chime (G5 -> E6)
    samples = []
    notes = [783.99, 1318.51] # G5, E6
    duration_per_note = 0.08
    for i, note in enumerate(notes):
        for frame in range(int(SAMPLE_RATE * duration_per_note)):
            t = frame / SAMPLE_RATE
            # Softer, faster envelope
            envelope = math.exp(-t * 15)
            # Volume reduced drastically to 0.15
            s = math.sin(2 * math.pi * note * t) * envelope * 0.15
            # Softer harmonics
            s += math.sin(2 * math.pi * note * 2 * t) * envelope * 0.05
            samples.append(s)
    # let the last note ring out softly
    ring_duration = 0.25
    for frame in range(int(SAMPLE_RATE * ring_duration)):
        t = frame / SAMPLE_RATE
        envelope = math.exp(-t * 10) * math.exp(-duration_per_note * 15)
        s = math.sin(2 * math.pi * notes[-1] * (t + duration_per_note)) * envelope * 0.15
        samples.append(s)
    return samples

def generate_heal():
    # A magical rising sound
    samples = []
    duration = 0.6
    for i in range(int(SAMPLE_RATE * duration)):
        t = i / SAMPLE_RATE
        # frequency sweeps up from 400 to 1200
        freq = 400 + (800 * (t / duration))
        envelope = math.sin(math.pi * (t / duration)) # smooth fade in and out
        s = math.sin(2 * math.pi * freq * t) * envelope * 0.3
        # Add a shiny high frequency harmonic
        s += math.sin(2 * math.pi * freq * 2.5 * t) * envelope * 0.15
        samples.append(s)
    return samples

out_dir = os.path.join('frontend', 'src', 'assets', 'audio')
if not os.path.exists(out_dir):
    os.makedirs(out_dir)

make_wav(os.path.join(out_dir, 'click.wav'), generate_click())
make_wav(os.path.join(out_dir, 'buy.wav'), generate_buy())
make_wav(os.path.join(out_dir, 'heal.wav'), generate_heal())
print("Generated click.wav, buy.wav, and heal.wav")

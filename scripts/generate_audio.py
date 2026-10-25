import wave
import math
import struct
import random
import os

def generate_tone(filename, duration_ms, freq, volume=0.5, wave_type='square'):
    sample_rate = 44100
    num_samples = int(sample_rate * (duration_ms / 1000.0))
    
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        
        for i in range(num_samples):
            t = float(i) / sample_rate
            if wave_type == 'square':
                value = 1.0 if (t * freq) % 1.0 > 0.5 else -1.0
            elif wave_type == 'sine':
                value = math.sin(2.0 * math.pi * freq * t)
            elif wave_type == 'noise':
                value = random.uniform(-1.0, 1.0)
            elif wave_type == 'sawtooth':
                value = 2.0 * ((t * freq) % 1.0) - 1.0
            else:
                value = 0.0
                
            # Envelope (decay)
            envelope = max(0, 1.0 - (i / num_samples))
            
            sample = int(value * volume * envelope * 32767.0)
            wav_file.writeframesraw(struct.pack('<h', sample))

def generate_sequence(filename, notes, wave_type='square', volume=0.5):
    # notes is a list of (freq, duration_ms)
    sample_rate = 44100
    
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        
        for freq, duration_ms in notes:
            num_samples = int(sample_rate * (duration_ms / 1000.0))
            for i in range(num_samples):
                t = float(i) / sample_rate
                if wave_type == 'square':
                    value = 1.0 if (t * freq) % 1.0 > 0.5 else -1.0
                elif wave_type == 'sine':
                    value = math.sin(2.0 * math.pi * freq * t)
                elif wave_type == 'noise':
                    value = random.uniform(-1.0, 1.0)
                else:
                    value = 0.0
                    
                # Envelope for each note
                envelope = 1.0
                if i < 100: # attack
                    envelope = i / 100
                elif i > num_samples - 1000: # release
                    envelope = max(0, (num_samples - i) / 1000)
                
                sample = int(value * volume * envelope * 32767.0)
                wav_file.writeframesraw(struct.pack('<h', sample))

out_dir = "frontend/public/assets/audio"
os.makedirs(out_dir, exist_ok=True)

# click.wav - Short high pitch pip
generate_tone(f"{out_dir}/click.wav", 50, 800, 0.3, 'sine')

# shoot.wav - Short noisy laser
generate_tone(f"{out_dir}/shoot.wav", 100, 400, 0.4, 'sawtooth')

# hit.wav - Low pitch noise thud
generate_tone(f"{out_dir}/hit.wav", 150, 150, 0.6, 'noise')

# explosion.wav - Long noise
generate_tone(f"{out_dir}/explosion.wav", 400, 100, 0.8, 'noise')

# heal.wav - Two rising tones
generate_sequence(f"{out_dir}/heal.wav", [(400, 150), (600, 250)], 'sine', 0.5)

# buy.wav - Coin sound
generate_sequence(f"{out_dir}/buy.wav", [(800, 100), (1200, 300)], 'square', 0.4)

# menu_bgm.wav - Simple loop (arpeggio)
menu_notes = [(440, 250), (554, 250), (659, 250), (880, 250)] * 4 # A major arpeggio
generate_sequence(f"{out_dir}/menu_bgm.wav", menu_notes, 'sine', 0.2)

# world_1_bgm.wav - Intense loop (bass)
w1_notes = [(110, 200), (110, 200), (130, 200), (98, 200)] * 8
generate_sequence(f"{out_dir}/world_1_bgm.wav", w1_notes, 'square', 0.3)

print("Audio files generated successfully in", out_dir)

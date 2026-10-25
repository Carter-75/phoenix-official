import { Audio } from 'expo-av';

// Sound effects are real generated WAV files in assets/audio
// (scripts/generate_audio.py regenerates them). Music is a 16s looping pad.
const SFX: Record<string, any> = {
  shoot: require('../../assets/audio/shoot.wav'),
  hit: require('../../assets/audio/hit.wav'),
  explosion: require('../../assets/audio/explosion.wav'),
  playerHit: require('../../assets/audio/player_hit.wav'),
  coin: require('../../assets/audio/coin.wav'),
  click: require('../../assets/audio/click.wav'),
  levelup: require('../../assets/audio/levelup.wav'),
  boss: require('../../assets/audio/boss.wav'),
  revive: require('../../assets/audio/revive.wav'),
  beam: require('../../assets/audio/beam.wav'),
};
const MUSIC = require('../../assets/audio/music.wav');

export type SfxName = keyof typeof SFX;

class AudioService {
  private sounds = new Map<string, Audio.Sound>();
  private musicSound: Audio.Sound | null = null;
  private soundEnabled = true;
  private musicEnabled = true;
  private ready = false;
  private musicPlaying = false;

  setEnabled(sound: boolean, music: boolean) {
    this.soundEnabled = sound;
    this.musicEnabled = music;
    if (!music) this.stopMusic();
    else if (this.ready) this.startMusic();
  }

  async init() {
    if (this.ready) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
      });
      for (const [name, src] of Object.entries(SFX)) {
        const { sound } = await Audio.Sound.createAsync(src, { volume: name === 'shoot' ? 0.25 : 0.6 });
        this.sounds.set(name, sound);
      }
      const { sound: music } = await Audio.Sound.createAsync(MUSIC, { isLooping: true, volume: 0.35 });
      this.musicSound = music;
      this.ready = true;
      if (this.musicEnabled) this.startMusic();
    } catch (e) {
      // Audio is best-effort: the game must run silently rather than crash.
      this.ready = false;
    }
  }

  async startMusic() {
    if (!this.musicSound || !this.musicEnabled || this.musicPlaying) return;
    try {
      await this.musicSound.playAsync();
      this.musicPlaying = true;
    } catch {}
  }

  async stopMusic() {
    if (!this.musicSound) return;
    try {
      await this.musicSound.pauseAsync();
      this.musicPlaying = false;
    } catch {}
  }

  play(name: SfxName) {
    if (!this.soundEnabled) return;
    const sound = this.sounds.get(name);
    if (!sound) return;
    sound.replayAsync().catch(() => {});
  }
}

export const audio = new AudioService();

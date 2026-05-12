// ============================================================
// Ameath Music Player — MP3 background playback
// ============================================================

class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.volume = 1.0;
    this.musicFiles = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.enabled = false;
    this.volume = 100; // 0-150

    // Auto-advance to next track
    this.audio.addEventListener("ended", () => {
      this.next();
    });
  }

  loadMusicList(customList) {
    const musicDir = "sound/music/";
    const builtinNames = [
      "碎花.mp3",
      "纸飞机.mp3",
      "远航星的告别.mp3",
      "那颗星梦见的春日.mp3",
    ];
    this.builtinFiles = builtinNames.map((n) => musicDir + n);
    this.customFiles = (customList || []).map(n => "__custom_music__:" + n);
    this.musicFiles = [...this.builtinFiles, ...this.customFiles];
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(150, vol));
    this.audio.volume = Math.min(1.0, this.volume / 100);
  }

  async play() {
    if (!this.enabled || this.musicFiles.length === 0) return;
    if (this.currentIndex < 0 || this.currentIndex >= this.musicFiles.length) {
      this.currentIndex = 0;
    }
    let src = this.musicFiles[this.currentIndex];
    // Custom music: load from Rust backend as data URL
    if (src.startsWith("__custom_music__:")) {
      const filename = src.slice("__custom_music__:".length);
      try {
        src = await window.__TAURI__.core.invoke("read_custom_file", { fileType: "music", filename });
      } catch (e) {
        console.warn("Custom music load failed:", filename, e);
        this.next();
        return;
      }
    }
    this.audio.src = src;
    this.audio.volume = Math.min(1.0, this.volume / 100);
    this.audio.play().catch((e) => console.warn("Music play failed:", e));
    this.isPlaying = true;
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
  }

  resume() {
    if (this.audio.src) {
      this.audio.play().catch(() => {});
      this.isPlaying = true;
    } else {
      this.play();
    }
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.resume();
    }
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying = false;
  }

  next() {
    if (this.musicFiles.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.musicFiles.length;
    if (this.isPlaying || this.enabled) {
      this.play();
    }
  }

  prev() {
    if (this.musicFiles.length === 0) return;
    this.currentIndex =
      (this.currentIndex - 1 + this.musicFiles.length) % this.musicFiles.length;
    if (this.isPlaying || this.enabled) {
      this.play();
    }
  }

  getCurrentSongName() {
    if (this.currentIndex < 0 || this.currentIndex >= this.musicFiles.length) {
      return "未选择歌曲";
    }
    const path = this.musicFiles[this.currentIndex];
    const name = decodeURIComponent(path.split("/").pop());
    return name.replace(/\.[^.]+$/, "");
  }

  getProgress() {
    if (!this.audio.duration) return 0;
    return this.audio.currentTime / this.audio.duration;
  }

  getDuration() {
    return this.audio.duration || 0;
  }

  getCurrentTime() {
    return this.audio.currentTime || 0;
  }

  seek(fraction) {
    if (this.audio.duration) {
      this.audio.currentTime = fraction * this.audio.duration;
    }
  }
}

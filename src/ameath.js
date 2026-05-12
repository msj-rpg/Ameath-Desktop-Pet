// ============================================================
// Ameath Desktop Pet — Frontend Engine (Tauri v2)
// Canvas-based GIF renderer with per-frame delays, drag,
// voice, follow mouse, right-click menu.
// ============================================================

const { invoke } = window.__TAURI__.core;

// ============ Constants (mirroring constants.py) ============
const PET_BASE_SIZE = 200;
const SPEED_X = 3;
const SPEED_Y = 2;
const STOP_CHANCE = 0.003;
const STOP_DURATION_MIN = 4000;
const STOP_DURATION_MAX = 8000;
const MOVE_INTERVAL = 30;
const JITTER_INTERVAL = 5;
const EDGE_ESCAPE_CHANCE = 0.3;
const RESPAWN_MARGIN = 50;
const TARGET_CHANGE_MIN = 200;
const TARGET_CHANGE_MAX = 500;
const OUTSIDE_TARGET_CHANCE = 0.4;
const FOLLOW_DISTANCE = 80;
const INERTIA_FACTOR = 0.95;
const INTENT_FACTOR = 0.05;
const JITTER = 0.15;
const MOTION_WANDER = "wander";
const MOTION_FOLLOW = "follow";
const MOTION_CURIOUS = "curious";
const MOTION_REST = "rest";
const REST_CHANCE = 0.6;
const REST_DURATION_MIN = 1000;
const REST_DURATION_MAX = 3000;
const REST_DISTANCE = 20;
const FOLLOW_START_DIST = 200;
const FOLLOW_STOP_DIST = 60;
const SPEED_WANDER = 0.8;
const SPEED_FOLLOW = 1.2;
const SPEED_CURIOUS = 0.5;
const STAY_PUT_CHANCE = 0.3;
const MIN_INTERVAL = 30000;
const MAX_INTERVAL = 120000;

const SCALE_OPTIONS = [];
for (let i = 1; i <= 20; i++) SCALE_OPTIONS.push(+(i / 10).toFixed(1));
const TRANSPARENCY_OPTIONS = [];
for (let i = 1; i <= 10; i++) TRANSPARENCY_OPTIONS.push(+(i / 10).toFixed(1));

// ============ Voice Player ============
// Voice action types
const VOICE_ACTIONS = [
  { key: "startup", label: "启动", defaults: ["现实系统，侵入完成.wav"] },
  { key: "idle", label: "待机", defaults: ["看这里.wav"] },
  { key: "wander", label: "游荡", defaults: ["嗯.wav", "嗯，哼哼.wav", "嗯，嘿嘿.wav", "嘿嘿.wav"] },
  { key: "drag", label: "拖拽", defaults: ["一起去拯救世界吧.wav", "你，看见我了.wav"] },
  { key: "screen", label: "趴窗", defaults: [] },
];

class VoicePlayer {
  constructor() {
    this.audioCtx = null;
    this.voiceFiles = [];
    this.lastVoice = null;
    this.consecutiveCount = 0;
    this.volume = 1.0;
    this.enabled = true;
    this._currentSource = null;
    this._cache = new Map();
    // Per-action voice map: action → [urls]
    this._actionMap = {};
  }

  async loadVoiceList(voiceMap) {
    const voiceDir = "sound/voice/";
    const builtinNames = [
      "一起去拯救世界吧.wav", "你，看见我了.wav", "嗯.wav",
      "嗯，哼哼.wav", "嗯，嘿嘿.wav", "嘿嘿.wav",
      "现实系统，侵入完成.wav", "看这里.wav",
    ];
    this.voiceFiles = builtinNames.map((n) => voiceDir + n);

    // Build per-action map: use config overrides or defaults
    for (const action of VOICE_ACTIONS) {
      const customList = voiceMap?.[action.key];
      if (customList && customList.length > 0) {
        // Custom files: resolve to data URLs via Rust
        const urls = [];
        for (const f of customList) {
          if (f.startsWith("sound/") || f.startsWith("data:")) {
            urls.push(f); // builtin or already resolved
          } else {
            urls.push("__custom_voice__:" + f); // marker for lazy load
          }
        }
        this._actionMap[action.key] = urls;
      } else {
        // Defaults
        this._actionMap[action.key] = action.defaults.map(n => voiceDir + n);
      }
    }
  }

  getActionVoices(action) {
    return this._actionMap[action] || [];
  }

  _getAudioCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioCtx;
  }

  async _loadBuffer(url) {
    if (this._cache.has(url)) return this._cache.get(url);
    try {
      let fetchUrl = url;
      // Custom voice: load bytes from Rust backend
      if (url.startsWith("__custom_voice__:")) {
        const filename = url.slice("__custom_voice__:".length);
        fetchUrl = await invoke("read_custom_file", { fileType: "voice", filename });
      }
      const resp = await fetch(fetchUrl);
      const buf = await resp.arrayBuffer();
      const decoded = await this._getAudioCtx().decodeAudioData(buf);
      this._cache.set(url, decoded);
      return decoded;
    } catch (e) {
      console.warn("Voice load failed:", url, e);
      return null;
    }
  }

  stop() {
    if (this._currentSource) {
      try { this._currentSource.stop(); } catch (_) {}
      this._currentSource = null;
    }
  }

  async playRandom() {
    if (!this.enabled || this.voiceFiles.length === 0) return;

    let file;
    if (this.voiceFiles.length === 1) {
      file = this.voiceFiles[0];
    } else {
      if (this.consecutiveCount >= 2 && this.lastVoice !== null) {
        const others = this.voiceFiles.filter((f) => f !== this.lastVoice);
        file = others[Math.floor(Math.random() * others.length)] || this.voiceFiles[0];
      } else {
        file = this.voiceFiles[Math.floor(Math.random() * this.voiceFiles.length)];
      }
    }

    if (file === this.lastVoice) {
      this.consecutiveCount++;
    } else {
      this.lastVoice = file;
      this.consecutiveCount = 0;
    }

    const buffer = await this._loadBuffer(file);
    if (!buffer) return;

    this.stop();
    const ctx = this._getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = this.volume;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(0);
    this._currentSource = source;
  }

  async playSpecific(url) {
    if (!this.enabled) return;
    const buffer = await this._loadBuffer(url);
    if (!buffer) return;
    this.stop();
    const ctx = this._getAudioCtx();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = this.volume;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
    this._currentSource = source;
  }

  async playFromList(urls) {
    if (!this.enabled || urls.length === 0) return;
    const url = urls[Math.floor(Math.random() * urls.length)];
    await this.playSpecific(url);
  }
}

// ============ Pet Class ============
class AmeathPet {
  constructor() {
    this.canvas = document.getElementById("pet-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.screenW = 1920;
    this.screenH = 1080;
    this.petW = PET_BASE_SIZE;
    this.petH = PET_BASE_SIZE;
    this.x = 600;
    this.y = 400;
    this.vx = SPEED_X;
    this.vy = SPEED_Y;
    this.scale = 1.0;
    this.scaleIndex = 9;
    this.transparencyIndex = 9;

    // State
    this.motionState = MOTION_WANDER;
    this.isMoving = true;
    this.isPaused = false;
    this.movingRight = true;
    this.clickThrough = true;
    this.followMouse = false;
    this.alwaysOnTop = true;
    this.wanderIdleStayMode = 2;
    this.visible = true;
    this.displayPriority = 1;  // 1=always on top, 2=hide when fullscreen
    this.windowSnap = true;    // enable window snap while paused
    this.totalScreen = false;  // cross-screen wandering
    this.wanderSpeed = SPEED_WANDER; // configurable wander speed multiplier

    // Targets
    this.targetX = 0;
    this.targetY = 0;
    this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
    this.restTimer = 0;

    // Idle
    this.isIdlePlaying = false;
    this.idleAllowsMove = false;

    // Jitter
    this._moveTick = 0;
    this._jitterX = 0;
    this._jitterY = 0;

    // Mouse tracking
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._prevMouseX = 0;
    this._prevMouseY = 0;
    this._mouseMoved = false;
    this._mousePolling = false;

    // Monitor
    this._screenIndex = 0;
    this._screenOffsetX = 0;
    this._screenOffsetY = 0;

    // Voice cooldown (ms since last voice play)
    this._lastVoiceTime = 0;
    this._voiceCooldown = 6000; // minimum 6s between any two voices

    // Window snap state (wandering)
    this._windowSnapActive = false;  // currently perched on a window
    this._windowSnapTimer = null;
    this._windowRects = [];          // cached visible window rects
    this._windowPollTick = 0;        // poll every N frames
    this._snapCooldownUntil = 0;     // don't snap again too soon
    this._snapSeekActive = false;    // actively heading toward a window
    this._snapSeekEnabled = true;    // actively seek windows to snap
    this._snapSeekInterval = 30;     // seconds between seek attempts

    // Window snap state (paused mode)
    this._pausedSnapped = false;     // paused and snapped to a window
    this._pausedSnapX = 0;           // position before snap
    this._pausedSnapY = 0;
    this._oldPausedSnapped = false;  // detect state change

    // Drag
    this.dragging = false;
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._preDragAnim = null;

    // Animation state
    this._animations = {};   // name -> parsed GIF data
    this._animFlipped = {};  // name -> flipped version
    this._currentAnimName = "move";
    this._frameIndex = 0;
    this._animTimerId = null;
    this._pausedTimerId = null;

    // Voice
    this.voice = new VoicePlayer();

    // Music
    this.music = new MusicPlayer();

    // Idle mode (system inactivity)
    this._idleModeEnabled = false;
    this._idleModeDelay = 60;        // seconds of inactivity before triggering
    this._idleModeMusic = "爱弥斯的待机小曲.mp3";
    this._idleModeActive = false;    // currently in idle mode
    this._idlePollTimer = null;
    this._idleAudio = new Audio();   // dedicated audio for idle music
    this._idleAudio.addEventListener("ended", () => this._exitIdleMode());

    // Context menu
    this._menuEl = document.getElementById("context-menu");
  }

  _randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ============ Initialization ============
  async init() {
    // Load config
    try {
      const cfg = await invoke("load_config");
      this.scale = cfg.scale || 1.0;
      this.clickThrough = cfg.click_through !== false;
      this.followMouse = cfg.follow_mouse || false;
      this.alwaysOnTop = cfg.always_on_top !== false;
      this.wanderIdleStayMode = cfg.wander_idle_stay_mode ?? 2;
      this.isPaused = cfg.paused || false;
      this.displayPriority = cfg.display_priority ?? 1;
      this.windowSnap = cfg.window_snap !== false;
      this._snapSeekEnabled = cfg.snap_seek_enabled !== false;
      this._snapSeekInterval = cfg.snap_seek_interval ?? 30;
      this.totalScreen = cfg.total_screen || false;
      this.wanderSpeed = cfg.wander_speed ?? SPEED_WANDER;
      this._screenIndex = cfg.screen_index ?? 0;

      const alpha = cfg.transparency ?? 1.0;
      await invoke("set_opacity", { alpha });

      // Voice config
      const voiceEnabled = cfg.voice_enabled !== false;
      const voiceVolume = cfg.voice_volume ?? 100;
      this.voice.enabled = voiceEnabled;
      this.voice.volume = voiceVolume / 100;

      // Music config
      this.music.enabled = cfg.music_enabled || false;
      this.music.setVolume(cfg.music_volume ?? 100);

      // Idle mode config
      this._idleModeEnabled = cfg.idle_mode_enabled || false;
      this._idleModeDelay = cfg.idle_mode_delay ?? 60;
      this._idleModeMusic = cfg.idle_mode_music || "爱弥斯的待机小曲.mp3";
    } catch (e) {
      console.warn("Config load failed, using defaults:", e);
    }

    // Screen size — compute activity area based on total_screen mode
    try {
      const monitors = await invoke("get_monitors");
      if (this.totalScreen && monitors.length > 1) {
        // Cross-screen: merge all monitors into one big area
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const [mx, my, mw, mh] of monitors) {
          left = Math.min(left, mx);
          top = Math.min(top, my);
          right = Math.max(right, mx + mw);
          bottom = Math.max(bottom, my + mh);
        }
        this._screenOffsetX = left;
        this._screenOffsetY = top;
        this.screenW = right - left;
        this.screenH = bottom - top;
      } else {
        // Single monitor mode
        const idx = Math.min(this._screenIndex, monitors.length - 1);
        if (monitors.length > 0) {
          const [mx, my, mw, mh] = monitors[idx];
          this._screenOffsetX = mx;
          this._screenOffsetY = my;
          this.screenW = mw;
          this.screenH = mh;
        } else {
          const [sw, sh] = await invoke("get_screen_size");
          this.screenW = sw;
          this.screenH = sh;
        }
      }
    } catch (e) {
      console.warn("Screen size query failed:", e);
    }

    // Pet dimensions
    this.petW = Math.round(PET_BASE_SIZE * this.scale);
    this.petH = Math.round(PET_BASE_SIZE * this.scale);
    this.canvas.width = this.petW;
    this.canvas.height = this.petH;

    await invoke("resize_window", { w: this.petW, h: this.petH });

    // Random start position
    this.x = this._randInt(0, this.screenW - this.petW);
    this.y = this._randInt(0, this.screenH - this.petH);
    await invoke("move_window", { x: this.x, y: this.y });

    // Click-through
    await invoke("set_click_through", { enable: this.clickThrough });

    // Load GIF animations
    await this._loadAllAnimations();

    // Voice (pass custom voice map from config)
    try {
      const cfg2 = await invoke("load_config");
      await this.voice.loadVoiceList(cfg2.voice_map || {});
    } catch (e) {
      await this.voice.loadVoiceList({});
    }

    // Music (pass custom music list from config)
    try {
      const cfg3 = await invoke("load_config");
      this.music.loadMusicList(cfg3.custom_music || []);
    } catch (e) {
      this.music.loadMusicList([]);
    }

    // Initial target
    [this.targetX, this.targetY] = this._getRandomTarget();

    // Set initial animation
    this._setAnimation("move");

    // Startup voice
    this.voice.playFromList(this.voice.getActionVoices("startup"));

    // Start animation loop
    this._animateFrame();

    // Start movement
    if (this.isPaused) {
      this._setAnimation("idle2");
      this._schedulePausedCycle();
    }
    this._moveLoop();

    // Mouse polling
    this._startMousePolling();

    // Display priority
    this._applyDisplayPriority();

    // Drag events
    this._bindDragEvents();

    // Context menu
    this._bindContextMenu();

    // Idle mode polling
    this._startIdlePoll();

    // Listen for settings changes from settings window
    this._listenConfigChanges();
  }

  _listenConfigChanges() {
    try {
      window.__TAURI__.event.listen("config-changed", async (event) => {
        const cfg = event.payload;
        if (!cfg) return;

        // Apply scale change
        const newScale = cfg.scale ?? this.scale;
        if (Math.abs(newScale - this.scale) > 0.01) {
          const idx = Math.round(newScale * 10) - 1;
          await this.setScale(idx);
        }

        // Apply transparency
        const alpha = cfg.transparency ?? 1.0;
        await invoke("set_opacity", { alpha });
        this.transparencyIndex = Math.round(alpha * 10) - 1;

        // Wander mode
        this.wanderIdleStayMode = cfg.wander_idle_stay_mode ?? 2;

        // Voice
        this.voice.enabled = cfg.voice_enabled !== false;
        this.voice.volume = (cfg.voice_volume ?? 100) / 100;

        // Music
        this.music.enabled = cfg.music_enabled || false;
        this.music.setVolume(cfg.music_volume ?? 100);

        // Display priority
        const newPriority = cfg.display_priority ?? 1;
        if (newPriority !== this.displayPriority) {
          this.displayPriority = newPriority;
          this._applyDisplayPriority();
        }

        // Wander speed
        this.wanderSpeed = cfg.wander_speed ?? SPEED_WANDER;

        // Idle mode
        this._idleModeEnabled = cfg.idle_mode_enabled || false;
        this._idleModeDelay = cfg.idle_mode_delay ?? 60;
        this._idleModeMusic = cfg.idle_mode_music || "爱弥斯的待机小曲.mp3";
        if (!this._idleModeEnabled && this._idleModeActive) {
          this._exitIdleMode();
        }

        // Window snap
        this.windowSnap = cfg.window_snap !== false;
        this._snapSeekEnabled = cfg.snap_seek_enabled !== false;
        this._snapSeekInterval = cfg.snap_seek_interval ?? 30;

        // Total screen / screen index — recompute activity area
        const newTotalScreen = cfg.total_screen || false;
        const newScreenIdx = cfg.screen_index ?? 0;
        if (newTotalScreen !== this.totalScreen || newScreenIdx !== this._screenIndex) {
          this.totalScreen = newTotalScreen;
          this._screenIndex = newScreenIdx;
          try {
            const monitors = await invoke("get_monitors");
            if (this.totalScreen && monitors.length > 1) {
              let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
              for (const [mx, my, mw, mh] of monitors) {
                left = Math.min(left, mx);
                top = Math.min(top, my);
                right = Math.max(right, mx + mw);
                bottom = Math.max(bottom, my + mh);
              }
              this._screenOffsetX = left;
              this._screenOffsetY = top;
              this.screenW = right - left;
              this.screenH = bottom - top;
            } else if (newScreenIdx < monitors.length) {
              const [mx, my, mw, mh] = monitors[newScreenIdx];
              this.screenW = mw;
              this.screenH = mh;
              this._screenOffsetX = mx;
              this._screenOffsetY = my;
              // Move pet to center of new monitor
              this.x = mx + (mw - this.petW) / 2;
              this.y = my + (mh - this.petH) / 2;
              await invoke("move_window", { x: this.x, y: this.y });
            }
            [this.targetX, this.targetY] = this._getRandomTarget();
          } catch (e) {
            console.warn("Monitor switch failed:", e);
          }
        }
      });
    } catch (e) {
      console.warn("Event listener setup failed:", e);
    }
  }

  // ============ GIF Loading ============
  async _loadAllAnimations() {
    const scale = this.scale;
    const load = async (name, path) => {
      try {
        const gif = await GifParser.parse(path, scale);
        this._animations[name] = gif;
        if (name === "move") {
          this._animFlipped["move"] = GifParser.flipFrames(gif);
        }
      } catch (e) {
        console.warn(`Failed to load ${name}:`, e);
      }
    };

    const tasks = [
      load("move", "gifs/move.gif"),
      load("drag", "gifs/drag.gif"),
    ];
    for (let i = 1; i <= 4; i++) tasks.push(load(`idle${i}`, `gifs/idle${i}.gif`));
    for (let i = 1; i <= 7; i++) tasks.push(load(`screen${i}`, `gifs/screen${i}.gif`));

    await Promise.all(tasks);
  }

  // ============ Animation Rendering ============
  _setAnimation(name, force) {
    // During idle mode, only allow idle animations (unless forced by idle mode itself)
    if (this._idleModeActive && !force && !name.startsWith("idle")) return;

    if (name === this._currentAnimName && this._animTimerId !== null) return;
    this._currentAnimName = name;
    this._frameIndex = 0;

    // idle4 → 50% chance play idle voice
    if (name === "idle4" && Math.random() < 0.5) {
      this._tryPlayActionVoice("idle");
    }
  }

  _getCurrentAnim() {
    const name = this._currentAnimName;
    // Original GIF faces RIGHT; flipped version faces LEFT
    if (name === "move" && !this.movingRight && this._animFlipped["move"]) {
      return this._animFlipped["move"];
    }
    return this._animations[name] || this._animations["move"];
  }

  _animateFrame() {
    const anim = this._getCurrentAnim();
    if (!anim || !anim.frames.length) {
      requestAnimationFrame(() => this._animateFrame());
      return;
    }

    if (this._frameIndex >= anim.frames.length) this._frameIndex = 0;
    const frame = anim.frames[this._frameIndex];

    // Draw frame to canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(frame.canvas, 0, 0, this.canvas.width, this.canvas.height);

    const delay = frame.delay || 80;
    this._frameIndex++;
    if (this._frameIndex >= anim.frames.length) this._frameIndex = 0;

    this._animTimerId = setTimeout(() => {
      requestAnimationFrame(() => this._animateFrame());
    }, delay);
  }

  // ============ Mouse Polling ============
  _startMousePolling() {
    if (this._mousePolling) return;
    this._mousePolling = true;
    const poll = async () => {
      if (!this._mousePolling) return;
      try {
        const [mx, my] = await invoke("get_mouse_position");
        this._mouseMoved = (mx !== this._lastMouseX || my !== this._lastMouseY);
        this._prevMouseX = this._lastMouseX;
        this._prevMouseY = this._lastMouseY;
        this._lastMouseX = mx;
        this._lastMouseY = my;
      } catch (_) {}
      setTimeout(poll, 100);
    };
    poll();
  }

  // ============ Drag ============
  _bindDragEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (this.clickThrough) return;
      this._startDrag(e);
    });
    window.addEventListener("mousemove", (e) => {
      if (this.dragging) this._doDrag(e);
    });
    window.addEventListener("mouseup", (e) => {
      if (this.dragging) this._stopDrag(e);
    });
  }

  async _startDrag(e) {
    this.dragging = true;
    // Get window position so we can compute offset
    const [wx, wy] = await invoke("get_window_position");
    this._dragStartX = e.screenX - wx;
    this._dragStartY = e.screenY - wy;

    // Save current animation and switch to drag
    this._preDragAnim = this._currentAnimName;
    this._setAnimation("drag");
    this._frameIndex = 0;

    // Play drag voice
    this.voice.playFromList(this.voice.getActionVoices("drag"));
  }

  _doDrag(e) {
    if (!this.dragging) return;
    this.x = e.screenX - this._dragStartX;
    this.y = e.screenY - this._dragStartY;
    invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
  }

  _stopDrag(_e) {
    this.dragging = false;
    this._dragEdgeCooldown = Date.now() + 2000; // no warp for 2s after drag
    if (this._preDragAnim) {
      this._setAnimation(this._preDragAnim);
      this._preDragAnim = null;
    }
    // Fix facing direction based on position relative to screen center
    const centerX = this.screenW / 2;
    this.movingRight = this.x < centerX;
    this.vx = this.movingRight ? Math.abs(this.vx) : -Math.abs(this.vx);
  }

  // ============ Context Menu ============
  _bindContextMenu() {
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.clickThrough) return;
      this._showContextMenu(e.clientX, e.clientY);
    });
    document.addEventListener("click", (e) => {
      if (!this._menuEl.contains(e.target)) {
        this._hideContextMenu();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this._hideContextMenu();
    });
  }

  async _showContextMenu(x, y) {
    // Temporarily pause pet while menu is open
    this._menuTempPaused = false;
    if (!this.isPaused) {
      this._menuTempPaused = true;
      this.isPaused = true;
      this.isMoving = false;
    }

    const menu = this._menuEl;
    // Show "real" pause state (not the temp pause)
    const reallyPaused = this.isPaused && !this._menuTempPaused;
    // Music label
    const musicLabel = !this.music.enabled
      ? "🎵 音乐（未启用）"
      : this.music.isPlaying
        ? "⏹ 停止演出"
        : "▶ 演出开始";
    const items = [
      { label: musicLabel, action: () => this._toggleMusic(), disabled: !this.music.enabled },
      { separator: true },
      { label: this.followMouse ? "✓ 跟随鼠标" : "　跟随鼠标", action: () => this.toggleFollow() },
      { label: reallyPaused ? "▶ 继续" : "⏸ 暂停", action: () => this.togglePause() },
      { label: this.clickThrough ? "✓ 鼠标穿透" : "　鼠标穿透", action: () => this.toggleClickThrough() },
      { separator: true },
      { label: this.visible ? "👁 隐藏" : "👁 显示", action: () => this.toggleVisibility() },
      { separator: true },
      { label: "更多设置...", action: () => this._openSettings() },
      { label: "退出", action: () => invoke("quit_app").catch(() => {}) },
    ];

    menu.innerHTML = "";
    for (const item of items) {
      if (item.separator) {
        const div = document.createElement("div");
        div.className = "menu-separator";
        menu.appendChild(div);
      } else {
        const div = document.createElement("div");
        div.className = item.disabled ? "menu-item disabled" : "menu-item";
        div.textContent = item.label;
        if (!item.disabled) {
          div.addEventListener("click", () => {
            this._hideContextMenu();
            item.action();
          });
        }
        menu.appendChild(div);
      }
    }

    // Expand window to make room for the menu
    const expandW = this.petW + 200;
    const expandH = this.petH + 300;
    await invoke("resize_window", { w: expandW, h: expandH });
    this._menuExpanded = true;

    menu.style.display = "block";
    // Position menu near click but within expanded area
    const menuX = Math.min(x, expandW - 160);
    const menuY = Math.min(y, expandH - 250);
    menu.style.left = Math.max(0, menuX) + "px";
    menu.style.top = Math.max(0, menuY) + "px";
  }

  async _hideContextMenu() {
    this._menuEl.style.display = "none";
    if (this._menuExpanded) {
      this._menuExpanded = false;
      await invoke("resize_window", { w: this.petW, h: this.petH });
    }
    // Resume if we temporarily paused
    if (this._menuTempPaused) {
      this._menuTempPaused = false;
      this.isPaused = false;
      this.isMoving = true;
      this._setAnimation("move");
    }
  }

  // ============ Random Target ============
  _getRandomTarget() {
    // OUTSIDE_TARGET_CHANCE probability: target outside screen to trigger edge effects
    if (Math.random() < OUTSIDE_TARGET_CHANCE) {
      const extraMargin = RESPAWN_MARGIN + 50;
      const side = this._randInt(0, 3); // 0=left 1=right 2=top 3=bottom
      if (side === 0) return [-extraMargin, this._randInt(0, this.screenH - this.petH)];
      if (side === 1) return [this.screenW + extraMargin, this._randInt(0, this.screenH - this.petH)];
      if (side === 2) return [this._randInt(0, this.screenW - this.petW), -extraMargin];
      return [this._randInt(0, this.screenW - this.petW), this.screenH + extraMargin];
    }
    const margin = 20;
    return [
      this._randInt(margin, this.screenW - this.petW - margin),
      this._randInt(margin, this.screenH - this.petH - margin),
    ];
  }

  _handleEdge() {
    const allowWarp = !this._dragEdgeCooldown || Date.now() > this._dragEdgeCooldown;
    let escaped = false;

    // Check if pet has gone off-screen
    if (this.x < 0 || this.x > this.screenW - this.petW) escaped = true;
    if (this.y < 0 || this.y > this.screenH - this.petH) escaped = true;

    if (escaped) {
      if (allowWarp && Math.random() < EDGE_ESCAPE_CHANCE) {
        // Respawn from a random edge (like flying in from outside)
        this._respawnFromEdge();
        return true;
      }
      // Bounce: reverse velocity and clamp
      if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
      else if (this.x > this.screenW - this.petW) { this.x = this.screenW - this.petW; this.vx = -Math.abs(this.vx); }
      if (this.y < 0) { this.y = 0; this.vy = Math.abs(this.vy); }
      else if (this.y > this.screenH - this.petH) { this.y = this.screenH - this.petH; this.vy = -Math.abs(this.vy); }

      // Immediately update facing direction
      if (this.vx > 0 && !this.movingRight) { this.movingRight = true; this._setAnimation("move"); }
      else if (this.vx < 0 && this.movingRight) { this.movingRight = false; this._setAnimation("move"); }

      [this.targetX, this.targetY] = this._getRandomTarget();
      this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
      if (Math.random() < 0.2) this._tryPlayWanderVoice();
    }
    return false;
  }

  _respawnFromEdge() {
    // Reappear from a random screen edge with entry velocity (like source code)
    const side = this._randInt(0, 3);
    if (side === 0) { // left
      this.x = -RESPAWN_MARGIN;
      this.y = this._randInt(0, this.screenH - this.petH);
    } else if (side === 1) { // right
      this.x = this.screenW + RESPAWN_MARGIN;
      this.y = this._randInt(0, this.screenH - this.petH);
    } else if (side === 2) { // top
      this.y = -RESPAWN_MARGIN;
      this.x = this._randInt(0, this.screenW - this.petW);
    } else { // bottom
      this.y = this.screenH + RESPAWN_MARGIN;
      this.x = this._randInt(0, this.screenW - this.petW);
    }
    // Entry velocity pointing inward
    this.vx = (Math.random() < 0.5 ? -3 : 3);
    this.vy = this._randInt(-2, 2);
    this.movingRight = this.vx > 0;
    this._setAnimation("move");
    // New target inside screen
    [this.targetX, this.targetY] = this._getRandomTarget();
    this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
    invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
  }

  // ============ Idle / Rest ============
  _switchToIdle() {
    if (this.isPaused) {
      const dur = this._randInt(STOP_DURATION_MIN, STOP_DURATION_MAX);
      setTimeout(() => this._pausedCycle(), dur);
      return;
    }

    this.isIdlePlaying = false;
    this.idleAllowsMove = false;

    if (this.wanderIdleStayMode === 0) {
      this.isIdlePlaying = true;
      this.idleAllowsMove = true;
      this.isMoving = true;
    } else if (this.wanderIdleStayMode === 2) {
      this.isIdlePlaying = true;
      this.idleAllowsMove = false;
      this.isMoving = false;
    } else {
      if (Math.random() < STAY_PUT_CHANCE) {
        this.isIdlePlaying = true;
        this.idleAllowsMove = Math.random() >= 0.5;
        this.isMoving = this.idleAllowsMove;
      } else {
        this.isIdlePlaying = false;
        this.idleAllowsMove = false;
        this.isMoving = false;
      }
    }

    if (this.isIdlePlaying) {
      const idx = this._randInt(1, 4);
      this._setAnimation(`idle${idx}`);
      // 30% chance to make a small sound when stopping to idle
      if (Math.random() < 0.3) {
        this._tryPlayWanderVoice();
      }
    } else {
      // Not playing idle animation — show a random static frame of a random idle
      const idx = this._randInt(1, 4);
      const animName = `idle${idx}`;
      this._currentAnimName = animName;
      const anim = this._animations[animName];
      if (anim && anim.frames.length > 0) {
        this._frameIndex = this._randInt(0, anim.frames.length - 1);
      }
    }

    const stopDur = this._randInt(STOP_DURATION_MIN, STOP_DURATION_MAX);
    setTimeout(() => this._switchToMove(), stopDur);
  }

  _switchToMove() {
    if (this.isPaused || this._idleModeActive) return;
    this.isIdlePlaying = false;
    this.idleAllowsMove = false;
    this.isMoving = true;
    this._setAnimation("move");
  }

  // ============ Window Snap ============
  async _pollForegroundWindow() {
    try {
      const rect = await invoke("get_foreground_window_rect");
      if (rect) {
        this._windowRects = [rect];
        const [x, y, w, h] = rect;
        console.log(`[WindowSnap] Foreground window: (${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)})`);
      } else {
        this._windowRects = [];
      }
    } catch (e) {
      this._windowRects = [];
    }
  }

  _snapToWindow(snapX, snapY) {
    console.log(`[WindowSnap] ✅ Snapping to window at (${Math.round(snapX)}, ${Math.round(snapY)})`);
    this._windowSnapActive = true;
    this._snapSeekActive = false;
    this.isMoving = false;
    this.isIdlePlaying = true;

    // Move to perch position
    this.x = snapX;
    this.y = snapY;
    invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});

    // Play random screen animation
    const idx = this._randInt(1, 7);
    this._setAnimation(`screen${idx}`);

    // 20% chance to vocalize (use screen voice if available, else wander)
    if (Math.random() < 0.2) {
      const screenVoices = this.voice.getActionVoices("screen");
      if (screenVoices.length > 0) {
        this._tryPlayActionVoice("screen");
      } else {
        this._tryPlayWanderVoice();
      }
    }

    // Stay perched for 4-10 seconds, then maybe switch animation, then leave
    const stayDur = this._randInt(4000, 10000);
    this._windowSnapTimer = setTimeout(() => {
      // 40% chance to do a second animation before leaving
      if (Math.random() < 0.4) {
        const idx2 = this._randInt(1, 7);
        this._setAnimation(`screen${idx2}`);
        const extraDur = this._randInt(3000, 6000);
        this._windowSnapTimer = setTimeout(() => this._unsnapFromWindow(), extraDur);
      } else {
        this._unsnapFromWindow();
      }
    }, stayDur);
  }

  _unsnapFromWindow() {
    this._windowSnapActive = false;
    this._windowSnapTimer = null;
    this.isIdlePlaying = false;
    this.isMoving = true;
    this.motionState = MOTION_WANDER;
    this._setAnimation("move");
    // Cooldown: don't snap again for 15-30s
    this._snapCooldownUntil = Date.now() + this._randInt(15000, 30000);
    // Pick a new target away from the window
    [this.targetX, this.targetY] = this._getRandomTarget();
    this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
  }

  // ============ Paused Window Snap ============
  async _checkPausedWindowSnap() {
    try {
      this._windowRects = await invoke("get_visible_windows");
    } catch (e) {
      this._windowRects = [];
    }

    // Find a suitable window to perch on (use first visible window with valid area)
    let foundSnap = false;
    for (const [wx, wy, ww, wh] of this._windowRects) {
      const snapX = wx + ww - this.petW;   // right edge
      const snapY = wy - this.petH + 5;    // perch on top
      // Check within screen bounds
      if (snapX > 0 && snapX < this.screenW - this.petW &&
          snapY > 0 && snapY < this.screenH - this.petH) {
        if (!this._pausedSnapped) {
          // Save pre-snap position
          this._pausedSnapX = this.x;
          this._pausedSnapY = this.y;
        }
        this.x = snapX;
        this.y = snapY;
        invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
        foundSnap = true;
        break;
      }
    }

    const wasSnapped = this._pausedSnapped;
    this._pausedSnapped = foundSnap;

    // State transition: trigger animation change
    if (this._pausedSnapped !== wasSnapped) {
      if (this._pausedSnapped) {
        // Just snapped → switch to screen animation
        const idx = this._randInt(1, 7);
        this._setAnimation(`screen${idx}`);
        this._schedulePausedScreenCycle();
      } else {
        // Unsnapped → restore position and switch to idle
        this.x = this._pausedSnapX;
        this.y = this._pausedSnapY;
        invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
        this._setAnimation("idle2");
        this._schedulePausedCycle();
      }
    }
  }

  _schedulePausedScreenCycle() {
    if (!this.isPaused || !this._pausedSnapped) return;
    const dur = this._randInt(STOP_DURATION_MIN, STOP_DURATION_MAX);
    setTimeout(() => {
      if (!this.isPaused || !this._pausedSnapped) return;
      const idx = this._randInt(1, 7);
      this._setAnimation(`screen${idx}`);
      this._schedulePausedScreenCycle();
    }, dur);
  }

  // ============ Display Priority ============
  async _applyDisplayPriority() {
    if (this.displayPriority === 1) {
      // Always on top
      await invoke("set_always_on_top", { enable: true });
    } else if (this.displayPriority === 2) {
      // Will be handled by polling — start checking for fullscreen
      await invoke("set_always_on_top", { enable: true });
      this._startFullscreenCheck();
    }
  }

  _startFullscreenCheck() {
    if (this._fullscreenCheckTimer) return;
    this._fullscreenCheckTimer = setInterval(async () => {
      if (this.displayPriority !== 2) {
        clearInterval(this._fullscreenCheckTimer);
        this._fullscreenCheckTimer = null;
        if (!this.visible) {
          this.canvas.style.display = "";
          invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
          this.visible = true;
        }
        return;
      }
      try {
        const rects = await invoke("get_visible_windows");
        // If any window covers the full screen, hide pet
        let hasFullscreen = false;
        for (const [wx, wy, ww, wh] of rects) {
          if (ww >= this.screenW * 0.95 && wh >= this.screenH * 0.95) {
            hasFullscreen = true;
            break;
          }
        }
        if (hasFullscreen && this.visible) {
          this.canvas.style.display = "none";
          invoke("move_window", { x: -9999, y: -9999 }).catch(() => {});
          this.visible = false;
        } else if (!hasFullscreen && !this.visible) {
          this.canvas.style.display = "";
          invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
          this.visible = true;
        }
      } catch (e) {}
    }, 2000);
  }

  // ============ Voice Helpers ============
  _canPlayVoice() {
    return Date.now() - this._lastVoiceTime >= this._voiceCooldown;
  }

  _tryPlayVoice(url) {
    if (!this._canPlayVoice()) return;
    this._lastVoiceTime = Date.now();
    this._voiceCooldown = this._randInt(5000, 12000);
    this.voice.playSpecific(url);
  }

  _tryPlayActionVoice(action) {
    if (!this._canPlayVoice()) return;
    const voices = this.voice.getActionVoices(action);
    if (voices.length === 0) return;
    this._lastVoiceTime = Date.now();
    this._voiceCooldown = this._randInt(5000, 12000);
    this.voice.playFromList(voices);
  }

  _tryPlayWanderVoice() {
    if (!this._canPlayVoice()) return;
    const voices = this.voice.getActionVoices("wander");
    if (voices.length === 0) return;
    this._lastVoiceTime = Date.now();
    this._voiceCooldown = this._randInt(8000, 18000);
    this.voice.playFromList(voices);
  }

  // ============ Idle Mode (System Inactivity) ============
  _startIdlePoll() {
    if (this._idlePollTimer) clearInterval(this._idlePollTimer);
    this._idlePollTimer = setInterval(() => this._checkIdleMode(), 3000);
  }

  async _checkIdleMode() {
    if (!this._idleModeEnabled) {
      return;
    }
    if (this.isPaused || this._idleModeActive) return;
    try {
      const idleSec = await invoke("get_system_idle_seconds");
      console.log("[IdleMode] idle:", idleSec.toFixed(1) + "s, threshold:", this._idleModeDelay + "s");
      if (idleSec >= this._idleModeDelay) {
        this._enterIdleMode();
      }
    } catch (e) {
      console.warn("[IdleMode] get_system_idle_seconds failed:", e);
    }
  }

  async _enterIdleMode() {
    if (this._idleModeActive) return;
    console.log("[IdleMode] Entering idle mode, playing:", this._idleModeMusic);
    this._idleModeActive = true;

    // Pause normal music if playing
    if (this.music.isPlaying) {
      this._idleWasMusicPlaying = true;
      this.music.pause();
    } else {
      this._idleWasMusicPlaying = false;
    }

    // Stop movement, play random idle animation and keep cycling
    this.isMoving = false;
    this.isIdlePlaying = true;
    this._setAnimation(`idle${this._randInt(1, 4)}`);
    this._idleAnimCycleTimer = setInterval(() => {
      if (!this._idleModeActive) return;
      this._setAnimation(`idle${this._randInt(1, 4)}`);
    }, this._randInt(6000, 12000));

    // Resolve idle music source
    let src = "sound/music/" + this._idleModeMusic;
    // Check if it's a custom file (not in builtin list)
    const builtinMusic = ["碎花.mp3", "纸飞机.mp3", "远航星的告别.mp3", "那颗星梦见的春日.mp3", "爱弥斯的待机小曲.mp3"];
    if (!builtinMusic.includes(this._idleModeMusic)) {
      try {
        src = await invoke("read_custom_file", { fileType: "music", filename: this._idleModeMusic });
      } catch (e) {
        console.warn("Idle music load failed:", e);
        this._exitIdleMode();
        return;
      }
    }

    // Play idle music
    this._idleAudio.src = src;
    this._idleAudio.volume = Math.min(1.0, this.music.volume / 100);
    this._idleAudio.play().catch(e => {
      console.warn("Idle music play failed:", e);
      this._exitIdleMode();
    });

    // Also poll for user input to exit early
    this._idleExitPoll = setInterval(async () => {
      try {
        const idleSec = await invoke("get_system_idle_seconds");
        if (idleSec < 2) {
          this._exitIdleMode();
        }
      } catch (_) {}
    }, 1000);
  }

  _exitIdleMode() {
    if (!this._idleModeActive) return;
    console.log("[IdleMode] Exiting idle mode");
    this._idleModeActive = false;

    // Stop idle music
    this._idleAudio.pause();
    this._idleAudio.currentTime = 0;

    // Clear timers
    if (this._idleExitPoll) {
      clearInterval(this._idleExitPoll);
      this._idleExitPoll = null;
    }
    if (this._idleAnimCycleTimer) {
      clearInterval(this._idleAnimCycleTimer);
      this._idleAnimCycleTimer = null;
    }

    // Resume movement (force=true to override the idle mode guard since we just cleared it)
    this.isIdlePlaying = false;
    this.isMoving = true;
    this._setAnimation("move", true);

    // Resume normal music if it was playing
    if (this._idleWasMusicPlaying && this.music.enabled) {
      this.music.resume();
    }
  }

  // ============ Paused Cycle ============
  _schedulePausedCycle() {
    const interval = this._randInt(MIN_INTERVAL, MAX_INTERVAL);
    this._pausedTimerId = setTimeout(() => this._pausedCycle(), interval);
  }

  _pausedCycle() {
    if (!this.isPaused) return;
    // Pick from idle1-4 and screen1-7
    const pool = [];
    for (let i = 1; i <= 4; i++) pool.push(`idle${i}`);
    for (let i = 1; i <= 7; i++) pool.push(`screen${i}`);
    const pick = pool[this._randInt(0, pool.length - 1)];
    this._setAnimation(pick);
    const stopDur = this._randInt(STOP_DURATION_MIN, STOP_DURATION_MAX);
    setTimeout(() => {
      if (!this.isPaused) return;
      this._setAnimation("idle2");
      this._schedulePausedCycle();
    }, stopDur);
  }

  // ============ Main Move Loop ============
  _moveLoop() {
    // Idle mode — freeze movement
    if (this._idleModeActive) {
      setTimeout(() => this._moveLoop(), 200);
      return;
    }

    // Dragging — skip movement
    if (this.dragging) {
      setTimeout(() => this._moveLoop(), 50);
      return;
    }

    if (this.isPaused) {
      // Window snap during pause: check for visible windows periodically
      if (this.windowSnap) {
        this._windowPollTick++;
        if (this._windowPollTick >= 5) { // every ~500ms (at 100ms interval in paused)
          this._windowPollTick = 0;
          this._checkPausedWindowSnap();
        }
      }
      setTimeout(() => this._moveLoop(), 100);
      return;
    }

    // Window snap: periodically poll for windows and check proximity
    if (this.motionState === MOTION_WANDER && this.isMoving && !this._windowSnapActive) {
      this._windowPollTick++;
      if (this._windowPollTick >= 30) { // ~1s at 30ms interval
        this._windowPollTick = 0;
        this._pollForegroundWindow();

        // Active seek: after cooldown + seek interval elapsed, redirect toward window
        if (this._snapSeekEnabled && this.windowSnap
            && Date.now() > this._snapCooldownUntil
            && Date.now() > (this._snapSeekNextTime || 0)
            && !this._snapSeekActive && this._windowRects.length > 0) {
          const [wx, wy, ww] = this._windowRects[0];
          const seekX = wx + ww - this.petW;
          const seekY = wy - this.petH + 5;
          if (seekX > 0 && seekX < this.screenW - this.petW
              && seekY > 0 && seekY < this.screenH - this.petH) {
            this.targetX = seekX;
            this.targetY = seekY;
            this.targetTimer = this._randInt(300, 500);
            this._snapSeekActive = true;
            // Next seek attempt after interval (with ±30% jitter for natural feel)
            const jitter = this._snapSeekInterval * 1000 * (0.7 + Math.random() * 0.6);
            this._snapSeekNextTime = Date.now() + jitter;
            console.log(`[WindowSnap] 🎯 Seeking window at (${Math.round(seekX)},${Math.round(seekY)}), next seek in ${Math.round(jitter / 1000)}s`);
          }
        }
        if (this._snapSeekActive && this.targetTimer <= 0) {
          this._snapSeekActive = false;
        }
      }
      // Check if near a window top edge → snap
      if (Date.now() > this._snapCooldownUntil && this._windowRects.length > 0) {
        let closestDist = Infinity;
        let closestInfo = null;
        for (const [wx, wy, ww, wh] of this._windowRects) {
          // Pet is near the top-right area of the window
          const snapX = wx + ww - this.petW;  // right edge
          const snapY = wy - this.petH + 5;   // perch on top
          const dx = Math.abs(this.x - snapX);
          const dy = Math.abs(this.y - snapY);
          const dist = dx + dy;
          if (dist < closestDist) {
            closestDist = dist;
            closestInfo = { wx: Math.round(wx), wy: Math.round(wy), ww: Math.round(ww), wh: Math.round(wh), dx: Math.round(dx), dy: Math.round(dy), snapX: Math.round(snapX), snapY: Math.round(snapY) };
          }
          if (dx < 60 && dy < 40) {
            this._snapToWindow(snapX, snapY);
            setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
            return;
          }
        }
        // Log closest window proximity every ~3s (every 100 ticks)
        if (!this._snapLogTick) this._snapLogTick = 0;
        this._snapLogTick++;
        if (this._snapLogTick >= 100 && closestInfo) {
          this._snapLogTick = 0;
          const ci = closestInfo;
          console.log(`[WindowSnap] Pet(${Math.round(this.x)},${Math.round(this.y)}) closest window(${ci.wx},${ci.wy} ${ci.ww}x${ci.wh}) snapTarget(${ci.snapX},${ci.snapY}) dist dx=${ci.dx} dy=${ci.dy}`);
        }
      } else if (Date.now() <= this._snapCooldownUntil) {
        // Cooldown active — log once
        if (!this._snapCooldownLogged) {
          console.log(`[WindowSnap] Cooldown active, ${Math.round((this._snapCooldownUntil - Date.now()) / 1000)}s remaining`);
          this._snapCooldownLogged = true;
        }
      } else {
        this._snapCooldownLogged = false;
      }
    }

    // Currently snapped to window — stay put
    if (this._windowSnapActive) {
      setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
      return;
    }

    // Random stop while wandering
    if (this.motionState === MOTION_WANDER && this.isMoving) {
      if (!this.isIdlePlaying && Math.random() < STOP_CHANCE) {
        this._switchToIdle();
        setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
        return;
      }
    }

    // Rest state
    if (this.motionState === MOTION_REST) {
      this.restTimer -= MOVE_INTERVAL;
      if (this.restTimer <= 0) {
        this.motionState = MOTION_WANDER;
        [this.targetX, this.targetY] = this._getRandomTarget();
        this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
        this._switchToMove();
      }
      setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
      return;
    }

    if (!this.isMoving) {
      setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
      return;
    }

    // Mouse position for follow
    const mx = this._lastMouseX;
    const my = this._lastMouseY;

    // Distance to target
    let dx = this.targetX - this.x;
    let dy = this.targetY - this.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    // Force wander if follow disabled
    if (!this.followMouse && (this.motionState === MOTION_FOLLOW || this.motionState === MOTION_CURIOUS)) {
      this.motionState = MOTION_WANDER;
    }

    // Follow mode: distance-based state switching
    if (this.followMouse) {
      const distMouse = Math.sqrt((mx - this.x) ** 2 + (my - this.y) ** 2);
      if (distMouse > FOLLOW_START_DIST) {
        this.motionState = MOTION_FOLLOW;
      } else if (distMouse < FOLLOW_STOP_DIST) {
        this.motionState = MOTION_CURIOUS;
      }
    }

    // Wander: arrived at target
    if (this.motionState === MOTION_WANDER && dist < REST_DISTANCE) {
      if (Math.random() < REST_CHANCE) {
        if (this.wanderIdleStayMode === 0) {
          [this.targetX, this.targetY] = this._getRandomTarget();
          this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
        } else {
          if (!this.isIdlePlaying) {
            this.motionState = MOTION_REST;
            this.restTimer = this._randInt(REST_DURATION_MIN, REST_DURATION_MAX);
            this._switchToIdle();
            setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
            return;
          }
        }
      } else {
        [this.targetX, this.targetY] = this._getRandomTarget();
        this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
      }
    }

    // Periodic target change (wander)
    if (this.motionState === MOTION_WANDER) {
      this.targetTimer -= 1;
      if (this.targetTimer <= 0) {
        [this.targetX, this.targetY] = this._getRandomTarget();
        this.targetTimer = this._randInt(TARGET_CHANGE_MIN, TARGET_CHANGE_MAX);
      }
    }

    // Speed multiplier
    let speedMul = 1.0;
    if (this.motionState === MOTION_WANDER) speedMul = this.wanderSpeed;
    else if (this.motionState === MOTION_FOLLOW) speedMul = SPEED_FOLLOW;
    else if (this.motionState === MOTION_CURIOUS) speedMul = SPEED_CURIOUS;

    // Follow/curious: update target toward mouse only when mouse has moved
    if (this.motionState === MOTION_FOLLOW || this.motionState === MOTION_CURIOUS) {
      if (this._mouseMoved) {
        const offset = this.motionState === MOTION_FOLLOW ? FOLLOW_DISTANCE : FOLLOW_STOP_DIST;
        this.targetX = mx + this._randInt(-offset, offset);
        this.targetY = my + this._randInt(-offset, offset);
      }
    }

    // Recalc distance
    dx = this.targetX - this.x;
    dy = this.targetY - this.y;
    dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));

    // Desired velocity
    const desiredVx = (dx / dist) * SPEED_X * speedMul;
    const desiredVy = (dy / dist) * SPEED_Y * speedMul;

    // Inertia blending
    this.vx = this.vx * INERTIA_FACTOR + desiredVx * INTENT_FACTOR;
    this.vy = this.vy * INERTIA_FACTOR + desiredVy * INTENT_FACTOR;

    // Jitter
    this._moveTick++;
    if (this._moveTick % JITTER_INTERVAL === 0) {
      this._jitterX = (Math.random() * 2 - 1) * JITTER;
      this._jitterY = (Math.random() * 2 - 1) * JITTER;
    }
    this.vx += this._jitterX;
    this.vy += this._jitterY;

    // Apply
    this.x += this.vx;
    this.y += this.vy;

    // Edge handling (bounce or respawn)
    if (!this._handleEdge()) {
      // No respawn — check direction flip
      const newRight = this.vx > 0.5;
      const newLeft = this.vx < -0.5;
      if (newRight && !this.movingRight && !this.isIdlePlaying) {
        this.movingRight = true;
        this._setAnimation("move");
      } else if (newLeft && this.movingRight && !this.isIdlePlaying) {
        this.movingRight = false;
        this._setAnimation("move");
      }
    }

    // Move native window
    invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});

    setTimeout(() => this._moveLoop(), MOVE_INTERVAL);
  }

  // ============ Tray / Menu Controls ============
  toggleVisibility() {
    this.visible = !this.visible;
    if (this.visible) {
      this.canvas.style.display = "";
      invoke("move_window", { x: Math.round(this.x), y: Math.round(this.y) }).catch(() => {});
    } else {
      this.canvas.style.display = "none";
      invoke("move_window", { x: -9999, y: -9999 }).catch(() => {});
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.isMoving = false;
      this._setAnimation("idle2");
      this._schedulePausedCycle();
    } else {
      if (this._pausedTimerId) {
        clearTimeout(this._pausedTimerId);
        this._pausedTimerId = null;
      }
      this._switchToMove();
    }
    this._syncTray();
    this._saveConfig();
  }

  toggleFollow() {
    this.followMouse = !this.followMouse;
    if (!this.followMouse) {
      this.motionState = MOTION_WANDER;
      [this.targetX, this.targetY] = this._getRandomTarget();
    }
    this._syncTray();
    this._saveConfig();
  }

  _toggleMusic() {
    if (!this.music.enabled) return;
    this.music.togglePlayPause();
  }

  _openSettings() {
    // Open settings window via Rust command
    invoke("open_settings").catch(() => {
      console.warn("Settings window not implemented yet");
    });
  }

  async toggleClickThrough() {
    this.clickThrough = !this.clickThrough;
    await invoke("set_click_through", { enable: this.clickThrough });
    this._syncTray();
    this._saveConfig();
  }

  async setScale(index) {
    this.scaleIndex = index;
    this.scale = SCALE_OPTIONS[index];
    this.petW = Math.round(PET_BASE_SIZE * this.scale);
    this.petH = Math.round(PET_BASE_SIZE * this.scale);
    this.canvas.width = this.petW;
    this.canvas.height = this.petH;
    await invoke("resize_window", { w: this.petW, h: this.petH });
    // Reload animations at new scale
    await this._loadAllAnimations();
    this._saveConfig();
  }

  async setTransparency(index) {
    this.transparencyIndex = index;
    const alpha = TRANSPARENCY_OPTIONS[index];
    await invoke("set_opacity", { alpha });
    this._saveConfig();
  }

  _syncTray() {
    invoke("update_tray_state", {
      paused: this.isPaused,
      follow_mouse: this.followMouse,
      click_through: this.clickThrough,
    }).catch(() => {});
  }

  async _saveConfig() {
    const cfg = {
      scale: this.scale,
      transparency: TRANSPARENCY_OPTIONS[this.transparencyIndex],
      click_through: this.clickThrough,
      follow_mouse: this.followMouse,
      always_on_top: this.alwaysOnTop,
      speed_x: SPEED_X,
      speed_y: SPEED_Y,
      wander_idle_stay_mode: this.wanderIdleStayMode,
      paused: this.isPaused,
      voice_enabled: this.voice.enabled,
      voice_volume: Math.round(this.voice.volume * 100),
      music_enabled: this.music.enabled,
      music_volume: this.music.volume,
      screen_index: this._screenIndex,
      display_priority: this.displayPriority,
      window_snap: this.windowSnap,
      snap_seek_enabled: this._snapSeekEnabled,
      snap_seek_interval: this._snapSeekInterval,
      total_screen: this.totalScreen,
      wander_speed: this.wanderSpeed,
      idle_mode_enabled: this._idleModeEnabled,
      idle_mode_delay: this._idleModeDelay,
      idle_mode_music: this._idleModeMusic,
    };
    try {
      // Merge with existing config to preserve voice_map/custom_music
      const existing = await invoke("load_config");
      cfg.voice_map = existing.voice_map || {};
      cfg.custom_music = existing.custom_music || [];
      await invoke("save_config", { cfg });
    } catch (e) {
      console.warn("Config save failed:", e);
    }
  }
}

// ============ Bootstrap ============
const pet = new AmeathPet();

// Expose to Rust tray menu via window.__ameath
window.__ameath = {
  toggleVisibility: () => pet.toggleVisibility(),
  togglePause: () => pet.togglePause(),
  toggleFollow: () => pet.toggleFollow(),
  toggleClickThrough: () => pet.toggleClickThrough(),
};

// Wait for Tauri to be ready
if (document.readyState === "complete" || document.readyState === "interactive") {
  pet.init();
} else {
  document.addEventListener("DOMContentLoaded", () => pet.init());
}

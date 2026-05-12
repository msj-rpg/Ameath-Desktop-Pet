use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("ameath_config.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetConfig {
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default = "default_transparency")]
    pub transparency: f64,
    #[serde(default = "default_true")]
    pub click_through: bool,
    #[serde(default = "default_false")]
    pub follow_mouse: bool,
    #[serde(default = "default_true")]
    pub always_on_top: bool,
    #[serde(default = "default_speed_x")]
    pub speed_x: f64,
    #[serde(default = "default_speed_y")]
    pub speed_y: f64,
    #[serde(default = "default_wander_mode")]
    pub wander_idle_stay_mode: u8,
    #[serde(default = "default_false")]
    pub paused: bool,
    #[serde(default = "default_true")]
    pub voice_enabled: bool,
    #[serde(default = "default_voice_volume")]
    pub voice_volume: u32,
    #[serde(default = "default_false")]
    pub music_enabled: bool,
    #[serde(default)]
    pub screen_index: u32,
    #[serde(default = "default_music_volume")]
    pub music_volume: u32,
    #[serde(default = "default_display_priority")]
    pub display_priority: u8,
    #[serde(default = "default_true")]
    pub window_snap: bool,
    #[serde(default = "default_true")]
    pub snap_seek_enabled: bool,
    #[serde(default = "default_snap_seek_interval")]
    pub snap_seek_interval: u32,
    #[serde(default = "default_false")]
    pub total_screen: bool,
    #[serde(default = "default_wander_speed")]
    pub wander_speed: f64,
    #[serde(default = "default_false")]
    pub idle_mode_enabled: bool,
    #[serde(default = "default_idle_mode_delay")]
    pub idle_mode_delay: u32,
    #[serde(default = "default_idle_mode_music")]
    pub idle_mode_music: String,
    #[serde(default)]
    pub voice_map: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub custom_music: Vec<String>,
}

fn default_scale() -> f64 { 1.0 }
fn default_transparency() -> f64 { 1.0 }
fn default_true() -> bool { true }
fn default_false() -> bool { false }
fn default_speed_x() -> f64 { 3.0 }
fn default_speed_y() -> f64 { 2.0 }
fn default_wander_mode() -> u8 { 2 }
fn default_voice_volume() -> u32 { 100 }
fn default_music_volume() -> u32 { 100 }
fn default_display_priority() -> u8 { 1 }
fn default_wander_speed() -> f64 { 0.8 }
fn default_snap_seek_interval() -> u32 { 30 }
fn default_idle_mode_delay() -> u32 { 60 }
fn default_idle_mode_music() -> String { "爱弥斯的待机小曲.mp3".to_string() }

impl Default for PetConfig {
    fn default() -> Self {
        Self {
            scale: default_scale(),
            transparency: default_transparency(),
            click_through: default_true(),
            follow_mouse: default_false(),
            always_on_top: default_true(),
            speed_x: default_speed_x(),
            speed_y: default_speed_y(),
            wander_idle_stay_mode: default_wander_mode(),
            paused: default_false(),
            voice_enabled: default_true(),
            voice_volume: default_voice_volume(),
            music_enabled: default_false(),
            music_volume: default_music_volume(),
            screen_index: 0,
            display_priority: default_display_priority(),
            window_snap: default_true(),
            snap_seek_enabled: default_true(),
            snap_seek_interval: default_snap_seek_interval(),
            total_screen: default_false(),
            wander_speed: default_wander_speed(),
            idle_mode_enabled: default_false(),
            idle_mode_delay: default_idle_mode_delay(),
            idle_mode_music: default_idle_mode_music(),
            voice_map: HashMap::new(),
            custom_music: Vec::new(),
        }
    }
}

pub fn load() -> PetConfig {
    let path = config_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        PetConfig::default()
    }
}

pub fn save(cfg: &PetConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let data = serde_json::to_string_pretty(cfg).unwrap_or_default();
    let _ = fs::write(path, data);
}

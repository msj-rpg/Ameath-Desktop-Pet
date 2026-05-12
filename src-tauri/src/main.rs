#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use std::sync::Mutex;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
};

mod config;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "windows")]
mod windows;

struct TrayMenuItems {
    pause: CheckMenuItem<tauri::Wry>,
    follow: CheckMenuItem<tauri::Wry>,
    clickthrough: CheckMenuItem<tauri::Wry>,
}

#[tauri::command]
fn load_config() -> config::PetConfig {
    config::load()
}

#[tauri::command]
fn save_config(cfg: config::PetConfig) {
    config::save(&cfg);
}

#[tauri::command]
fn set_click_through(app: AppHandle, enable: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_ignore_cursor_events(enable);
    }
}

#[tauri::command]
fn update_tray_state(app: AppHandle, paused: bool, follow_mouse: bool, click_through: bool) {
    if let Ok(items) = app.state::<Mutex<TrayMenuItems>>().lock() {
        let _ = items.pause.set_checked(paused);
        let _ = items.pause.set_text(if paused { "▶ 继续" } else { "⏸ 暂停" });
        let _ = items.follow.set_checked(follow_mouse);
        let _ = items.clickthrough.set_checked(click_through);
    }
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, enable: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(enable);
    }
}

#[tauri::command]
fn set_opacity(app: AppHandle, alpha: f64) {
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window("main") {
        macos::set_window_alpha(&window, alpha);
    }
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        // Use JS eval to set canvas opacity (avoids raw HWND layered window conflicts with WebView2)
        let _ = window.eval(&format!("document.querySelector('canvas').style.opacity='{}'", alpha));
    }
}

#[tauri::command]
fn move_window(app: AppHandle, x: f64, y: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let position = tauri::LogicalPosition::new(x, y);
        let _ = window.set_position(position);
    }
}

#[tauri::command]
fn resize_window(app: AppHandle, w: f64, h: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let size = tauri::LogicalSize::new(w, h);
        let _ = window.set_size(size);
    }
}

#[tauri::command]
fn get_mouse_position() -> (f64, f64) {
    #[cfg(target_os = "macos")]
    {
        return macos::get_mouse_position();
    }
    #[cfg(target_os = "windows")]
    {
        return windows::get_mouse_position();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        (0.0, 0.0)
    }
}

#[tauri::command]
fn get_window_position(app: AppHandle) -> (f64, f64) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(pos) = window.outer_position() {
            let scale = window.scale_factor().unwrap_or(1.0);
            return (pos.x as f64 / scale, pos.y as f64 / scale);
        }
    }
    (0.0, 0.0)
}

#[tauri::command]
fn get_screen_size(app: AppHandle) -> (f64, f64) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            return (size.width as f64 / scale, size.height as f64 / scale);
        }
    }
    (1920.0, 1080.0)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_monitors(app: AppHandle) -> Vec<(f64, f64, f64, f64)> {
    // Returns list of (x, y, width, height) in logical coords
    let mut result = Vec::new();
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(monitors) = window.available_monitors() {
            for m in monitors {
                let pos = m.position();
                let size = m.size();
                let scale = m.scale_factor();
                result.push((
                    pos.x as f64 / scale,
                    pos.y as f64 / scale,
                    size.width as f64 / scale,
                    size.height as f64 / scale,
                ));
            }
        }
    }
    result
}

#[tauri::command]
fn get_visible_windows() -> Vec<(f64, f64, f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id() as i64;
        return macos::get_visible_windows(pid);
    }
    #[cfg(target_os = "windows")]
    {
        let pid = std::process::id();
        return windows::get_visible_windows(pid);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}

#[tauri::command]
fn get_foreground_window_rect() -> Option<(f64, f64, f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id() as i64;
        return macos::get_foreground_window_rect(pid);
    }
    #[cfg(target_os = "windows")]
    {
        let pid = std::process::id();
        return windows::get_foreground_window_rect(pid);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

#[tauri::command]
fn get_system_idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    {
        return macos::get_system_idle_seconds();
    }
    #[cfg(target_os = "windows")]
    {
        return windows::get_system_idle_seconds();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        0.0
    }
}

// ============ Custom Audio File Management ============

fn custom_audio_dir(file_type: &str) -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("ameath").join(file_type)
}

#[tauri::command]
fn list_custom_files(file_type: String) -> Vec<String> {
    let dir = custom_audio_dir(&file_type);
    if !dir.exists() {
        return vec![];
    }
    let mut files = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let lower = name.to_lowercase();
                    if lower.ends_with(".wav") || lower.ends_with(".mp3")
                        || lower.ends_with(".ogg") || lower.ends_with(".flac")
                    {
                        files.push(name.to_string());
                    }
                }
            }
        }
    }
    files.sort();
    files
}

#[tauri::command]
fn read_custom_file(file_type: String, filename: String) -> Result<String, String> {
    let path = custom_audio_dir(&file_type).join(&filename);
    if !path.exists() {
        return Err("File not found".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    // Return as data URL
    let ext = filename.rsplit('.').next().unwrap_or("wav").to_lowercase();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "audio/wav",
    };
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn pick_audio_file(file_type: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    // This is called from settings window — we need to use blocking dialog
    // Since we're in an async command, we'll use std file dialog instead
    let dir = custom_audio_dir(&file_type);
    let _ = std::fs::create_dir_all(&dir);

    // Use rfd (raw file dialog) via tauri_plugin_dialog's blocking API
    let extensions = if file_type == "music" {
        vec!["mp3", "ogg", "flac", "wav"]
    } else {
        vec!["wav", "mp3", "ogg"]
    };

    let dialog = rfd::FileDialog::new()
        .add_filter("Audio", &extensions)
        .set_title(if file_type == "music" { "选择音乐文件" } else { "选择语音文件" });

    if let Some(path) = dialog.pick_file() {
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            let dest = dir.join(name);
            std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
            return Ok(name.to_string());
        }
    }
    Err("cancelled".into())
}

#[tauri::command]
fn remove_custom_file(file_type: String, filename: String) -> Result<(), String> {
    let path = custom_audio_dir(&file_type).join(&filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_custom_folder(file_type: String) {
    let dir = custom_audio_dir(&file_type);
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&dir).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(&dir).spawn();
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    // If settings window already exists, focus it
    if let Some(win) = app.get_webview_window("settings") {
        let _ = win.set_focus();
        return;
    }
    // Create a new settings window
    let _win = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::App("settings.html".into()),
    )
    .title("Ameath 设置")
    .inner_size(420.0, 800.0)
    .resizable(false)
    .center()
    .build();
}

#[tauri::command]
fn open_devtools(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // Load initial state from config
    let cfg = config::load();

    let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app, "pause",
        if cfg.paused { "▶ 继续" } else { "⏸ 暂停" },
        true, cfg.paused, None::<&str>,
    )?;
    let follow = CheckMenuItem::with_id(
        app, "follow", "跟随鼠标",
        true, cfg.follow_mouse, None::<&str>,
    )?;
    let clickthrough = CheckMenuItem::with_id(
        app, "clickthrough", "鼠标穿透",
        true, cfg.click_through, None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "更多设置...", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &pause, &follow, &clickthrough, &settings, &quit])?;

    // Store CheckMenuItem handles for later updates
    app.manage(Mutex::new(TrayMenuItems {
        pause: pause.clone(),
        follow: follow.clone(),
        clickthrough: clickthrough.clone(),
    }));

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("Ameath 桌面宠物")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            if let Some(window) = app.get_webview_window("main") {
                match id {
                    "show" => {
                        let _ = window.eval("window.__ameath?.toggleVisibility?.()");
                    }
                    "pause" => {
                        let _ = window.eval("window.__ameath?.togglePause?.()");
                    }
                    "follow" => {
                        let _ = window.eval("window.__ameath?.toggleFollow?.()");
                    }
                    "clickthrough" => {
                        let _ = window.eval("window.__ameath?.toggleClickThrough?.()");
                    }
                    "settings" => {
                        let _ = open_settings(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            set_click_through,
            set_always_on_top,
            set_opacity,
            move_window,
            resize_window,
            get_screen_size,
            get_mouse_position,
            get_window_position,
            quit_app,
            update_tray_state,
            open_settings,
            get_monitors,
            get_visible_windows,
            get_foreground_window_rect,
            get_system_idle_seconds,
            list_custom_files,
            read_custom_file,
            pick_audio_file,
            remove_custom_file,
            open_custom_folder,
            open_devtools,
        ])
        .setup(|app| {
            build_tray(&app.handle())?;

            // macOS: set window to appear on all spaces + click-through
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").unwrap();
                macos::setup_macos_window(&window);

                #[cfg(debug_assertions)]
                window.open_devtools();
            }

            // Windows: DevTools in dev mode
            #[cfg(target_os = "windows")]
            {
                #[cfg(debug_assertions)]
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

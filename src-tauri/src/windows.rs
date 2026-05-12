use windows::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::HiDpi::GetDpiForSystem;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetCursorPos, GetForegroundWindow, GetWindowLongW, GetWindowRect,
    GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

/// System DPI scale factor (1.0 = 100%, 1.25 = 125%, 1.5 = 150%, etc.)
fn dpi_scale() -> f64 {
    unsafe { GetDpiForSystem() as f64 / 96.0 }
}

/// Global mouse cursor position in logical screen coordinates.
pub fn get_mouse_position() -> (f64, f64) {
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            let s = dpi_scale();
            return (pt.x as f64 / s, pt.y as f64 / s);
        }
    }
    (0.0, 0.0)
}

/// Seconds since last user input (mouse move, key press, etc.)
pub fn get_system_idle_seconds() -> f64 {
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii).as_bool() {
            let now = GetTickCount();
            let elapsed = now.wrapping_sub(lii.dwTime);
            return elapsed as f64 / 1000.0;
        }
    }
    0.0
}

/// Rect of the foreground (active) window in logical coordinates.
/// Returns None if no foreground window or if it belongs to our own process.
pub fn get_foreground_window_rect(own_pid: u32) -> Option<(f64, f64, f64, f64)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut pid: u32 = 0;
        if GetWindowThreadProcessId(hwnd, Some(&mut pid)) == 0 {
            return None;
        }
        if pid == own_pid {
            return None;
        }
        let mut rc = RECT::default();
        if GetWindowRect(hwnd, &mut rc).is_ok() {
            let s = dpi_scale();
            let w = (rc.right - rc.left) as f64 / s;
            let h = (rc.bottom - rc.top) as f64 / s;
            if w >= 200.0 && h >= 100.0 {
                return Some((rc.left as f64 / s, rc.top as f64 / s, w, h));
            }
        }
    }
    None
}

struct EnumData {
    results: Vec<(f64, f64, f64, f64)>,
    own_pid: u32,
    scale: f64,
}

/// Rects of all visible normal windows (excluding our own, tool windows, tiny windows).
pub fn get_visible_windows(own_pid: u32) -> Vec<(f64, f64, f64, f64)> {
    let mut data = EnumData {
        results: Vec::new(),
        own_pid,
        scale: dpi_scale(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_cb),
            LPARAM(&mut data as *mut EnumData as isize),
        );
    }
    data.results
}

unsafe extern "system" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let data = &mut *(lparam.0 as *mut EnumData);

    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }
    // Skip tool windows (tooltips, floating toolbars, etc.)
    let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
    if ex & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }
    // Skip own process
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == data.own_pid {
        return BOOL(1);
    }
    let mut rc = RECT::default();
    if GetWindowRect(hwnd, &mut rc).is_ok() {
        let w = (rc.right - rc.left) as f64 / data.scale;
        let h = (rc.bottom - rc.top) as f64 / data.scale;
        if w >= 200.0 && h >= 100.0 {
            data.results.push((
                rc.left as f64 / data.scale,
                rc.top as f64 / data.scale,
                w,
                h,
            ));
        }
    }
    BOOL(1)
}

use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
use cocoa::base::id;
use core_foundation::base::{CFType, TCFType};
use core_foundation::array::CFArray;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::window::{
    kCGWindowListOptionOnScreenOnly, kCGWindowListExcludeDesktopElements,
    kCGNullWindowID,
};
use objc::runtime::YES;
use tauri::WebviewWindow;

/// Configure the NSWindow for desktop-pet behavior on macOS:
/// - Visible on all Spaces (Mission Control)
/// - Non-activating (doesn't steal focus)
/// - Ignores mouse events by default (click-through)
pub fn set_window_alpha(window: &WebviewWindow, alpha: f64) {
    let ns_window = window.ns_window().unwrap() as id;
    unsafe {
        let _: () = objc::msg_send![ns_window, setAlphaValue: alpha as f64];
    }
}

pub fn setup_macos_window(window: &WebviewWindow) {
    let ns_window = window.ns_window().unwrap() as id;

    unsafe {
        // Appear on all virtual desktops / spaces
        ns_window.setCollectionBehavior_(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
        );

        // Non-activating: don't steal focus when shown
        ns_window.setHasShadow_(false as i32 != 0);

        // Start with mouse events ignored (click-through)
        let _: () = objc::msg_send![ns_window, setIgnoresMouseEvents: YES];

        // Set window level to floating (above normal windows)
        // kCGFloatingWindowLevel = 3
        let _: () = objc::msg_send![ns_window, setLevel: 3i64];

        // Make the window background fully transparent
        let bg_color: id = objc::msg_send![objc::class!(NSColor), clearColor];
        let _: () = objc::msg_send![ns_window, setBackgroundColor: bg_color];
        let _: () = objc::msg_send![ns_window, setOpaque: false as i8];

        // Hide from Dock — become an accessory app (tray-only)
        // NSApplicationActivationPolicyAccessory = 1
        let app: id = objc::msg_send![objc::class!(NSApplication), sharedApplication];
        let _: () = objc::msg_send![app, setActivationPolicy: 1i64];
    }
}

/// Get system idle time in seconds (time since last user input event).
/// Checks multiple specific event types for reliability on newer macOS.
pub fn get_system_idle_seconds() -> f64 {
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            stateID: i32,
            eventType: u32,
        ) -> f64;
    }
    let mut min_idle = f64::MAX;
    // Check all relevant input event types
    let event_types: &[u32] = &[
        1,  // kCGEventLeftMouseDown
        2,  // kCGEventLeftMouseUp
        3,  // kCGEventRightMouseDown
        4,  // kCGEventRightMouseUp
        5,  // kCGEventMouseMoved
        6,  // kCGEventLeftMouseDragged
        7,  // kCGEventRightMouseDragged
        10, // kCGEventKeyDown
        11, // kCGEventKeyUp
        22, // kCGEventScrollWheel
        25, // kCGEventOtherMouseDown
        26, // kCGEventOtherMouseUp
        27, // kCGEventOtherMouseDragged
    ];
    for &et in event_types {
        let t = unsafe {
            CGEventSourceSecondsSinceLastEventType(0, et) // 0 = kCGEventSourceStateCombinedSessionState
        };
        if t >= 0.0 && t < min_idle {
            min_idle = t;
        }
    }
    if min_idle == f64::MAX { 0.0 } else { min_idle }
}

/// Get rects of visible on-screen windows (excluding desktop elements and our own).
/// Returns Vec of (x, y, width, height) in screen coordinates.
/// `own_pid` is our process PID so we can skip our own windows.
pub fn get_visible_windows(own_pid: i64) -> Vec<(f64, f64, f64, f64)> {
    let mut results = Vec::new();

    // CGWindowListCopyWindowInfo
    extern "C" {
        fn CGWindowListCopyWindowInfo(
            option: u32,
            relativeToWindow: u32,
        ) -> core_foundation::base::CFTypeRef;
    }

    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let cf_ref = unsafe { CGWindowListCopyWindowInfo(options, kCGNullWindowID) };
    if cf_ref.is_null() {
        return results;
    }

    let window_list: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(cf_ref as _) };

    let key_bounds = CFString::new("kCGWindowBounds");
    let key_layer = CFString::new("kCGWindowLayer");
    let key_pid = CFString::new("kCGWindowOwnerPID");
    let key_x = CFString::new("X");
    let key_y = CFString::new("Y");
    let key_w = CFString::new("Width");
    let key_h = CFString::new("Height");

    for i in 0..window_list.len() {
        let item = window_list.get(i).unwrap();
        // Each item is a CFDictionary
        let dict: CFDictionary<CFString, CFType> = unsafe {
            CFDictionary::wrap_under_get_rule(item.as_CFTypeRef() as _)
        };

        // Skip non-layer-0 windows (layer 0 = normal windows)
        if let Some(layer_val) = dict.find(&key_layer) {
            let layer_num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(layer_val.as_CFTypeRef() as _) };
            if let Some(layer) = layer_num.to_i32() {
                if layer != 0 {
                    continue;
                }
            }
        }

        // Skip our own windows
        if let Some(pid_val) = dict.find(&key_pid) {
            let pid_num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(pid_val.as_CFTypeRef() as _) };
            if let Some(pid) = pid_num.to_i64() {
                if pid == own_pid {
                    continue;
                }
            }
        }

        // Get bounds dict
        if let Some(bounds_val) = dict.find(&key_bounds) {
            let bounds_dict: CFDictionary<CFString, CFType> = unsafe {
                CFDictionary::wrap_under_get_rule(bounds_val.as_CFTypeRef() as _)
            };

            let get_f64 = |key: &CFString| -> f64 {
                if let Some(v) = bounds_dict.find(key) {
                    let n: CFNumber = unsafe { CFNumber::wrap_under_get_rule(v.as_CFTypeRef() as _) };
                    n.to_f64().unwrap_or(0.0)
                } else {
                    0.0
                }
            };

            let x = get_f64(&key_x);
            let y = get_f64(&key_y);
            let w = get_f64(&key_w);
            let h = get_f64(&key_h);

            // Filter tiny windows (toolbars, statusbar items, etc.)
            if w >= 200.0 && h >= 100.0 {
                results.push((x, y, w, h));
            }
        }
    }

    results
}

/// Get the frontmost (foreground) window rect, excluding our own.
/// Returns Option<(x, y, width, height)>. None if no foreground window found.
pub fn get_foreground_window_rect(own_pid: i64) -> Option<(f64, f64, f64, f64)> {
    // Reuse get_visible_windows and take the first result (sorted front-to-back by macOS)
    let windows = get_visible_windows(own_pid);
    windows.into_iter().next()
}

/// Get global mouse position in screen coordinates (top-left origin).
/// macOS uses bottom-left origin so we need to flip Y.
pub fn get_mouse_position() -> (f64, f64) {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState);
    if let Ok(source) = source {
        if let Ok(event) = CGEvent::new(source) {
            let point = event.location();
            // CGEvent location is already in top-left screen coordinates
            return (point.x, point.y);
        }
    }
    (0.0, 0.0)
}

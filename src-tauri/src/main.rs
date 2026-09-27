#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Work around the WebKitGTK DMA-BUF renderer crashing on the NVIDIA
/// proprietary driver, which leaves the app with a dead web process and a
/// window that never appears. WebKit, Tauri and NVIDIA each consider it the
/// others' bug, so it is ours to carry.
///
/// Turning that renderer off drops WebKitGTK to a slower compositing path, so
/// it is set only where the fault is: the proprietary driver creates one of the
/// two files below, and nouveau, AMD and Intel do not. A value the user set
/// always wins — someone on a driver where this is fixed sets it to 0 and keeps
/// the accelerated path.
///
/// `__NV_DISABLE_EXPLICIT_SYNC` is the other workaround that circulates for
/// this, and is deliberately not set here: it is a driver-wide switch that
/// would turn explicit sync off for every GL client in the process, which on a
/// current driver and compositor costs the tearing and stutter that protocol
/// exists to prevent. Anyone who needs it can set it themselves.
///
/// This runs before `run()` builds the app, because WebKitGTK reads the
/// variable when it spawns its web process. It is also before any thread
/// starts, which is what makes `set_var` sound.
#[cfg(target_os = "linux")]
fn apply_nvidia_webkit_workaround() {
    const RENDERER_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

    if std::env::var_os(RENDERER_VAR).is_some() {
        return;
    }
    let nvidia_driver_loaded = std::path::Path::new("/sys/module/nvidia/version").exists()
        || std::path::Path::new("/proc/driver/nvidia/version").exists();
    if !nvidia_driver_loaded {
        return;
    }

    std::env::set_var(RENDERER_VAR, "1");
    eprintln!(
        "PhotoSuite: NVIDIA driver detected — setting {RENDERER_VAR}=1 to work around the \
         WebKitGTK DMA-BUF crash. Set it yourself to override."
    );
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_nvidia_webkit_workaround();

    photosuite_lib::run()
}

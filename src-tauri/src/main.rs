#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Work around the WebKitGTK DMA-BUF renderer crashing on the NVIDIA
/// proprietary driver, which leaves the app with a dead web process and a
/// window that never appears. WebKit, Tauri and NVIDIA each consider it the
/// others' bug, so it is ours to carry.
///
/// Turning off `WEBKIT_DISABLE_DMABUF_RENDERER` drops WebKitGTK to a slower
/// compositing path, so it's set only where the fault is: the proprietary
/// driver, detected via the files below (nouveau, AMD and Intel don't create
/// them). `__NV_DISABLE_EXPLICIT_SYNC` is a driver-wide switch affecting every
/// GL client in the process, not just PhotoSuite, so each variable is checked
/// and set independently — a value already set, globally or by the user,
/// always wins.

///
/// This runs before `run()` builds the app, because WebKitGTK reads the
/// variable when it spawns its web process. It is also before any thread
/// starts, which is what makes `set_var` sound.
#[cfg(target_os = "linux")]
fn apply_nvidia_webkit_workaround() {
    const RENDERER_VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    const NVIDIA_VAR: &str = "__NV_DISABLE_EXPLICIT_SYNC";

    let nvidia_driver_loaded = std::path::Path::new("/sys/module/nvidia/version").exists()
        || std::path::Path::new("/proc/driver/nvidia/version").exists();
    if !nvidia_driver_loaded {
        return;
    }

    for var in [RENDERER_VAR, NVIDIA_VAR] {
        if std::env::var_os(var).is_some() {
            continue;
        }
        std::env::set_var(var, "1");
        eprintln!(
            "PhotoSuite: NVIDIA driver detected — setting {var}=1 to work \
             around the webKitGTK DMA-BUF crash. Set it yourself to override."
        );
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    apply_nvidia_webkit_workaround();

    photosuite_lib::run()
}

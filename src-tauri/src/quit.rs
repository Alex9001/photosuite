//! A quit event being queued is not proof that the webview handled it.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Default)]
pub struct QuitState {
    ready: AtomicBool,
    sequence: AtomicU64,
    pending: AtomicU64,
}

#[tauri::command]
pub fn photosuite_quit_ready(state: tauri::State<QuitState>) {
    state.ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn photosuite_acknowledge_quit(state: tauri::State<QuitState>, request_id: u64) {
    state.acknowledge(request_id);
}

impl QuitState {
    fn acknowledge(&self, request_id: u64) {
        let _ = self
            .pending
            .compare_exchange(request_id, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
}

/// Return true only when we have installed a handler and arranged recovery if
/// it fails to respond. Before frontend startup, closing needs no interception.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<QuitState>();
    if !state.ready.load(Ordering::SeqCst) {
        return false;
    }
    // Repeated close clicks must not postpone recovery or stack dialogs.
    let request_id = state.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    if state
        .pending
        .compare_exchange(0, request_id, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return true;
    }
    if app
        .emit(
            "photosuite:quit-requested",
            serde_json::json!({ "requestId": request_id }),
        )
        .is_err()
    {
        state.acknowledge(request_id);
        return false;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        if app.state::<QuitState>().pending.load(Ordering::SeqCst) != request_id {
            return;
        }
        let handle = app.clone();
        app.dialog()
            .message("PhotoSuite is not responding to the close request. Close it anyway? Any unsaved changes will be lost.")
            .title("Close PhotoSuite")
            .buttons(MessageDialogButtons::OkCancel)
            .show(move |confirmed| {
                handle.state::<QuitState>().acknowledge(request_id);
                if confirmed {
                    handle.exit(0);
                }
            });
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_acknowledgement_cannot_cancel_a_newer_quit() {
        let state = QuitState::default();
        state.pending.store(2, Ordering::SeqCst);
        state.acknowledge(1);
        assert_eq!(state.pending.load(Ordering::SeqCst), 2);
        state.acknowledge(2);
        assert_eq!(state.pending.load(Ordering::SeqCst), 0);
    }
}

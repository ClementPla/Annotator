#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // No `tracing_subscriber::fmt::init()` here. It installs a global `log`
    // logger through the tracing-log bridge, and `tauri_plugin_log` then fails
    // to install its own — `log::set_boxed_logger` allows exactly one — which
    // took the whole app down at startup rather than degrading to no file log.
    //
    // The plugin owns logging now (see `lib.rs`). `tracing` carries the `log`
    // feature, so ort's events still surface as log records when no tracing
    // subscriber is installed, which is now always.
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--ignore-gpu-blocklist",
        );
        std::env::set_var("RUST_LOG", "ort=debug");
    }
    didascalie_lib::run();
}
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--ignore-gpu-blocklist",
  );

    app_lib::run();


}


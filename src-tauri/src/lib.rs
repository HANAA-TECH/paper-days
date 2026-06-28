#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Lets the app show a native "choose a folder" dialog.
        .plugin(tauri_plugin_dialog::init())
        // Lets the app read/write files and create folders on disk.
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

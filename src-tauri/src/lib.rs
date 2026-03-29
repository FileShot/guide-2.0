/// guIDE 2.0 — Tauri Application Library
///
/// This is the Rust backend for the guIDE desktop application.
/// It manages:
///   - Application lifecycle
///   - Node.js backend sidecar process (runs the AI pipeline)
///   - Native commands exposed to the frontend
///   - System tray, menus, and native dialogs

use tauri::Manager;
use std::process::Command as StdCommand;
use std::sync::Mutex;
use std::path::PathBuf;

/// State to track the Node.js backend process
struct BackendState {
    process: Option<std::process::Child>,
    port: u16,
}

/// Launch the Node.js backend server.
/// Tries the bundled node.exe sidecar first, falls back to system node.
/// server_path: absolute path to server/main.js inside the resource dir.
/// working_dir: resource dir (so relative requires in server code work).
fn start_backend(
    node_exe: PathBuf,
    server_path: PathBuf,
    working_dir: PathBuf,
    port: u16,
) -> Result<std::process::Child, String> {
    if !server_path.exists() {
        return Err(format!("server/main.js not found at {:?}", server_path));
    }

    let node_cmd = if node_exe.exists() {
        println!("[Tauri] Using bundled node: {:?}", node_exe);
        node_exe
    } else {
        println!("[Tauri] Bundled node not found, falling back to system node");
        PathBuf::from("node")
    };

    println!("[Tauri] Starting backend: {:?} {:?} on port {}", node_cmd, server_path, port);

    let child = StdCommand::new(node_cmd)
        .arg(&server_path)
        .env("GUIDE_PORT", port.to_string())
        .env("PORT", port.to_string())
        .current_dir(&working_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Node.js backend: {}", e))?;

    println!("[Tauri] Backend started (PID: {})", child.id());
    Ok(child)
}

/// Find an available port starting from the preferred port
fn find_available_port(preferred: u16) -> u16 {
    for port in preferred..preferred + 100 {
        if std::net::TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok() {
            return port;
        }
    }
    preferred
}

/// Tauri command: Get the backend server URL
#[tauri::command]
fn get_backend_url(state: tauri::State<'_, Mutex<BackendState>>) -> String {
    let s = state.lock().unwrap();
    format!("http://localhost:{}", s.port)
}

/// Tauri command: Get the WebSocket URL
#[tauri::command]
fn get_ws_url(state: tauri::State<'_, Mutex<BackendState>>) -> String {
    let s = state.lock().unwrap();
    format!("ws://localhost:{}/ws", s.port)
}

/// Tauri command: Check if the backend is running
#[tauri::command]
fn is_backend_running(state: tauri::State<'_, Mutex<BackendState>>) -> bool {
    let mut s = state.lock().unwrap();
    if let Some(ref mut child) = s.process {
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(_) => false,
        }
    } else {
        false
    }
}

/// Tauri command: Get application info
#[tauri::command]
fn get_app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "guIDE",
        "version": "2.0.0",
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = find_available_port(3000);

    let backend_state = Mutex::new(BackendState {
        process: None,
        port,
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state)
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_ws_url,
            is_backend_running,
            get_app_info,
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();
            window.set_title("guIDE").unwrap_or(());

            // Resolve paths — bundled node.exe is next to the main exe,
            // server files are in the Tauri resource directory.
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."));

            let node_exe = exe_dir.join("node.exe");

            // resource_dir contains our bundled server/ and node_modules/
            let resource_dir = app.path().resource_dir()
                .unwrap_or_else(|_| exe_dir.clone());

            // Try resource_dir/server/main.js, then exe_dir/server/main.js
            let server_path = [
                resource_dir.join("server").join("main.js"),
                exe_dir.join("server").join("main.js"),
                exe_dir.join("..").join("server").join("main.js"),
            ]
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| resource_dir.join("server").join("main.js"));

            let working_dir = server_path
                .parent()
                .and_then(|p| p.parent())
                .unwrap_or(&resource_dir)
                .to_path_buf();

            // Start the backend
            match start_backend(node_exe, server_path, working_dir, port) {
                Ok(child) => {
                    let state = app.state::<Mutex<BackendState>>();
                    state.lock().unwrap().process = Some(child);
                }
                Err(e) => {
                    eprintln!("[Tauri] WARNING: Failed to start backend: {}", e);
                    eprintln!("[Tauri] AI features will not be available.");
                }
            }

            // Background thread: wait for backend health, then inject port into webview
            let port_clone = port;
            let window_clone = window.clone();
            std::thread::spawn(move || {
                for _ in 0..40 {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    if let Ok(resp) = reqwest::blocking::get(
                        format!("http://localhost:{}/api/health", port_clone)
                    ) {
                        if resp.status().is_success() {
                            println!("[Tauri] Backend ready on port {}", port_clone);
                            let _ = window_clone.eval(&format!(
                                "window.__GUIDE_BACKEND_PORT = {};",
                                port_clone
                            ));
                            return;
                        }
                    }
                }
                eprintln!("[Tauri] Backend did not respond within 10 seconds");
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<Mutex<BackendState>>() {
                    let mut s = state.lock().unwrap();
                    if let Some(ref mut child) = s.process {
                        println!("[Tauri] Killing backend process (PID: {})", child.id());
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

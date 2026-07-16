use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

#[tauri::command]
fn toggle_overlay(app: AppHandle) {
    toggle(&app);
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            position_overlay(&w);
            let _ = w.show();
        }
    }
}

// Stretch the overlay into a full-width strip along the bottom of the screen.
fn position_overlay(w: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = w.primary_monitor() {
        let scale = monitor.scale_factor();
        let logical_w = monitor.size().width as f64 / scale;
        let logical_h = monitor.size().height as f64 / scale;
        let strip_h = 340.0;
        let _ = w.set_size(tauri::LogicalSize::new(logical_w, strip_h));
        let _ = w.set_position(tauri::LogicalPosition::new(0.0, logical_h - strip_h));
    }
}

fn show_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![toggle_overlay])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // the character strip should never intercept mouse events
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.set_ignore_cursor_events(true);
            }

            // menu-bar tray: quick toggle without touching the Dock
            let toggle_i = MenuItem::with_id(app, "toggle", "캐릭터 켜기/끄기", true, None::<&str>)?;
            let panel_i = MenuItem::with_id(app, "panel", "컨트롤 패널 열기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_i, &panel_i, &quit_i])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle(app),
                    "panel" => show_panel(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the panel hides it; the app stays alive in the Dock/tray
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Dock icon click re-opens the control panel
            if let RunEvent::Reopen { .. } = event {
                show_panel(app);
            }
        });
}

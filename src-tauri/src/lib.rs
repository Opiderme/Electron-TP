use std::fs;

use serde::Serialize;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
struct FileData {
    path: String,
    content: String,
}

#[tauri::command]
fn open_file(app: tauri::AppHandle) -> Result<Option<FileData>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .blocking_pick_file();

    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    Ok(Some(FileData {
        path: path.to_string_lossy().to_string(),
        content,
    }))
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_as(
    app: tauri::AppHandle,
    content: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name("document.md")
        .blocking_save_file();

    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn confirm_close(app: tauri::AppHandle, window: tauri::WebviewWindow, ok: bool, is_quit: Option<bool>) -> Result<(), String> {
    if ok {
        if is_quit.unwrap_or(false) {
            app.exit(0);
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn ask_close(app: tauri::AppHandle) -> Result<bool, String> {
    let ans = app.dialog()
        .message("Des modifications non enregistrées seront perdues. Quitter quand même ?")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .title("Markdownitor")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom("Quitter".to_string(), "Annuler".to_string()))
        .blocking_show();
    Ok(ans)
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            open_file,
            save_file,
            save_file_as,
            set_window_title,
            notify,
            confirm_close,
            ask_close,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ── Menu applicatif ───────────────────────────────────────────────
            let file_menu = SubmenuBuilder::new(app, "Fichier")
                .item(
                    &MenuItemBuilder::with_id("new", "Nouveau")
                        .accelerator("Ctrl+N")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("open", "Ouvrir...")
                        .accelerator("Ctrl+O")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("save", "Enregistrer")
                        .accelerator("Ctrl+S")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("save-as", "Enregistrer sous...")
                        .accelerator("Ctrl+Shift+S")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("quit", "Quitter")
                        .accelerator("Ctrl+Q")
                        .build(app)?,
                )
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Édition")
                .item(&PredefinedMenuItem::undo(app, Some("Annuler"))?)
                .item(&PredefinedMenuItem::redo(app, Some("Rétablir"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("Couper"))?)
                .item(&PredefinedMenuItem::copy(app, Some("Copier"))?)
                .item(&PredefinedMenuItem::paste(app, Some("Coller"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("Tout sélectionner"))?)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "Affichage")
                .item(
                    &MenuItemBuilder::with_id("toggle-theme", "Changer de thème")
                        .accelerator("Ctrl+T")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("devtools", "Outils de développement")
                        .accelerator("F12")
                        .build(app)?,
                )
                .build()?;

            let format_menu = SubmenuBuilder::new(app, "Format")
                .item(
                    &MenuItemBuilder::with_id("bold", "Gras")
                        .accelerator("Ctrl+B")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("italic", "Italique")
                        .accelerator("Ctrl+I")
                        .build(app)?,
                )
                .build()?;

            let help_menu = SubmenuBuilder::new(app, "Aide")
                .item(&MenuItemBuilder::with_id("about", "À propos").build(app)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&format_menu)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                let id = event.id().0.as_str();
                match id {
                    "devtools" => {
                        if let Some(w) = app.get_webview_window("main") {
                            #[cfg(debug_assertions)]
                            {
                                if w.is_devtools_open() {
                                    w.close_devtools();
                                } else {
                                    w.open_devtools();
                                }
                            }
                            #[cfg(not(debug_assertions))]
                            {
                                let _ = w;
                            }
                        }
                    }
                    _ => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.emit("menu-action", id);
                        }
                    }
                }
            });

            // ── System Tray ───────────────────────────────────────────────────
            let tray_menu = MenuBuilder::new(app)
                .item(&MenuItemBuilder::with_id("tray-show", "Ouvrir Markdownitor").build(app)?)
                .separator()
                .item(&MenuItemBuilder::with_id("tray-quit", "Quitter").build(app)?)
                .build()?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Markdownitor")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().0.as_str() {
                    "tray-show" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("before-close", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

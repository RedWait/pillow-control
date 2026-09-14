#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use pillow_control::service::{Action, DesktopState, Service};
use std::sync::{atomic::Ordering, Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
fn local(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() == "main"
        && (url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost"))
    {
        Ok(())
    } else {
        Err("只允许本地桌面窗口调用".into())
    }
}
#[tauri::command]
async fn desktop_state(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<DesktopState, String> {
    local(&window)?;
    Ok(service.snapshot().await)
}
#[tauri::command]
async fn desktop_action(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<Service>>,
    action: Action,
    address: Option<String>,
) -> Result<DesktopState, String> {
    local(&window)?;
    if matches!(action, Action::Quit) {
        service.shutdown().await;
        app.exit(0);
    }
    Ok(service.action(action, address).await)
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let service = app.state::<Arc<Service>>();
        service.shutdown().await;
        app.exit(0);
    });
}
fn main() {
    if std::env::args().any(|a| a == "--verify-server") {
        let runtime = tokio::runtime::Runtime::new().expect("verification runtime");
        runtime.block_on(pillow_control::verification::run());
        return;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .invoke_handler(tauri::generate_handler![desktop_state, desktop_action])
        .setup(|app| {
            let service = Service::new().map_err(std::io::Error::other)?;
            app.manage(service.clone());
            let show_item =
                MenuItem::with_id(app, "show", "打开枕控 PillowControl", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "停止遥控", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", "退出枕控", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &stop, &exit])?;
            TrayIconBuilder::with_id("pillow-control")
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("枕控 PillowControl")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show(app),
                    "quit" => quit(app),
                    "stop" => {
                        let service = app.state::<Arc<Service>>().inner().clone();
                        tauri::async_runtime::spawn(async move {
                            service.action(Action::Stop, None).await;
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            tauri::async_runtime::spawn(async move {
                service.action(Action::Start, None).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if !window
                    .state::<Arc<Service>>()
                    .exiting
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::Resized(_) if window.is_minimized().unwrap_or(false) => {
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("枕控 PillowControl 启动失败");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app.state::<Arc<Service>>().exiting.load(Ordering::SeqCst) {
                api.prevent_exit();
                quit(app);
            }
        }
    });
}

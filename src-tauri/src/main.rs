#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use pillow_control::service::{Action, DesktopState, Service};
use pillow_control::updates::{UpdateAction, UpdateState, Updates};
use std::sync::{atomic::Ordering, Arc};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_autostart::ManagerExt;
#[derive(Default)]
struct StartupStatus(std::sync::Mutex<String>);
fn startup(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let run = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
            winreg::enums::KEY_SET_VALUE,
        )
        .map_err(|e| e.to_string())?;
    if !enabled {
        return match run.delete_value("pillow-control") {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("无法关闭开机自启：{e}")),
        };
    }
    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
    result.map_err(|e| format!("开机自启设置失败：{e}"))?;
    // auto-launch 0.5 does not quote executable paths on Windows. Correct the
    // fixed application entry so installation directories with spaces work.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    run.set_value(
        "pillow-control",
        &format!("\"{}\" --autostart", exe.display()),
    )
    .map_err(|e| format!("无法保存自启路径：{e}"))
}
fn enrich(app: &tauri::AppHandle, mut state: DesktopState) -> DesktopState {
    match app.autolaunch().is_enabled() {
        Ok(enabled) => state.autostart = enabled,
        Err(e) => state.error = format!("无法读取开机自启状态：{e}"),
    }
    let error = app.state::<StartupStatus>().0.lock().unwrap().clone();
    if !error.is_empty() {
        state.error = error;
    }
    state
}
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
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    service: tauri::State<'_, Arc<Service>>,
) -> Result<DesktopState, String> {
    local(&window)?;
    Ok(enrich(&app, service.snapshot().await))
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
    if matches!(action, Action::Start)
        && app.state::<Arc<Updates>>().snapshot().phase == "installing"
    {
        return Err("正在准备安装更新，请稍候".into());
    }
    if matches!(action, Action::Autostarton | Action::Autostartoff) {
        let enabled = matches!(action, Action::Autostarton);
        let previous = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
        startup(&app, enabled)?;
        if let Err(e) = service
            .store
            .lock()
            .unwrap()
            .update(|p| p.autostart = Some(enabled))
        {
            let _ = startup(&app, previous);
            return Err(e);
        }
        app.state::<StartupStatus>().0.lock().unwrap().clear();
    }
    if matches!(action, Action::Hide) {
        window.hide().map_err(|e| e.to_string())?;
        return Ok(enrich(&app, service.snapshot().await));
    }
    if matches!(action, Action::Quit) {
        service.shutdown().await;
        app.exit(0);
    }
    Ok(enrich(&app, service.action(action, address).await))
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
#[tauri::command]
fn update_state(
    window: tauri::WebviewWindow,
    updates: tauri::State<'_, Arc<Updates>>,
) -> Result<UpdateState, String> {
    local(&window)?;
    Ok(updates.snapshot())
}
#[tauri::command]
async fn update_action(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    updates: tauri::State<'_, Arc<Updates>>,
    service: tauri::State<'_, Arc<Service>>,
    action: UpdateAction,
    confirmed: Option<bool>,
) -> Result<UpdateState, String> {
    local(&window)?;
    updates
        .action(&app, &service, action, confirmed.unwrap_or(false))
        .await
}
fn main() {
    if std::env::args().any(|a| a == "--verify-server") {
        let runtime = tokio::runtime::Runtime::new().expect("verification runtime");
        runtime.block_on(pillow_control::verification::run());
        return;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !args.iter().any(|a| a == "--autostart") {
                show(app);
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("pillow-control")
                .args(["--autostart"])
                .build(),
        )
        .manage(StartupStatus::default())
        .invoke_handler(tauri::generate_handler![
            desktop_state,
            desktop_action,
            update_state,
            update_action
        ])
        .setup(|app| {
            // Fit the initial window into the usable desktop at its actual DPI.
            // Do this once: restoring from the tray must preserve user resizing.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let area = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    let current = window
                        .inner_size()?
                        .to_logical::<f64>(window.scale_factor()?);
                    let width = current.width.min((area.width - 32.0).max(320.0));
                    let height = current.height.min((area.height - 64.0).max(300.0));
                    window.set_min_size(Some(tauri::LogicalSize::new(
                        480.0_f64.min(width),
                        420.0_f64.min(height),
                    )))?;
                    window.set_size(tauri::LogicalSize::new(width, height))?;
                    window.center()?;
                }
            }
            let store = pillow_control::preferences::Store::open(
                app.path().app_local_data_dir()?.join("preferences.json"),
            )
            .map_err(std::io::Error::other)?;
            let service = Service::new(store).map_err(std::io::Error::other)?;
            app.manage(service.clone());
            let updates = Updates::new(
                app.package_info().version.to_string(),
                service.store.clone(),
            );
            app.manage(updates.clone());
            let update_handle = app.handle().clone();
            let update_service = service.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                if updates.snapshot().startup_check
                    && !update_service.exiting.load(Ordering::SeqCst)
                {
                    let _ = updates
                        .action(&update_handle, &update_service, UpdateAction::Check, false)
                        .await;
                }
            });
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
            if !std::env::args().any(|a| a == "--autostart") {
                show(app.handle());
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                service.action(Action::Start, None).await;
                let mut last = None;
                let mut ticks = 0u32;
                loop {
                    if service.exiting.load(Ordering::SeqCst) {
                        break;
                    }
                    let preference = service.store.lock().unwrap().get().autostart;
                    if let Some(enabled) = preference {
                        if last != Some(enabled) {
                            let result = startup(&handle, enabled);
                            *handle.state::<StartupStatus>().0.lock().unwrap() =
                                result.err().unwrap_or_default();
                            last = Some(enabled);
                        }
                    }
                    if ticks % 5 == 0 && service.desired_running.load(Ordering::SeqCst) {
                        if !service.snapshot().await.running {
                            service.retry_start().await;
                        }
                    }
                    ticks = ticks.wrapping_add(1);
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
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

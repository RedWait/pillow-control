use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::w,
    Win32::{
        Foundation::{COLORREF, POINT, RECT},
        Graphics::Gdi::*,
        UI::{Magnification::*, WindowsAndMessaging::*},
    },
};

/// Owns a click-through, non-activating Windows magnifier control on its own UI thread.
/// No screenshot ever leaves this process or the PC.
pub struct Lens {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Lens {
    pub fn start() -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let ending = stop.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        let thread = thread::spawn(move || unsafe {
            if !MagInitialize().as_bool() {
                let _ = tx.send(Err("Windows 放大镜初始化失败".into()));
                return;
            }
            let host = CreateWindowExW(
                WS_EX_TOPMOST
                    | WS_EX_LAYERED
                    | WS_EX_TRANSPARENT
                    | WS_EX_NOACTIVATE
                    | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("PillowControl pointer magnifier"),
                WS_POPUP | WS_BORDER,
                0,
                0,
                260,
                180,
                None,
                None,
                None,
                None,
            );
            match host {
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                }
                Ok(host) => {
                    let setup = (|| -> Result<_, String> {
                        SetLayeredWindowAttributes(host, COLORREF(0), 255, LWA_ALPHA)
                            .map_err(|e| e.to_string())?;
                        let child = CreateWindowExW(
                            WINDOW_EX_STYLE(0),
                            WC_MAGNIFIER,
                            w!(""),
                            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(MS_SHOWMAGNIFIEDCURSOR as u32),
                            0,
                            0,
                            258,
                            178,
                            Some(host),
                            None,
                            None,
                            None,
                        )
                        .map_err(|e| e.to_string())?;
                        let mut transform = MAGTRANSFORM {
                            v: [2.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0],
                        };
                        if !MagSetWindowTransform(child, &mut transform).as_bool() {
                            return Err("无法设置放大倍率".into());
                        }
                        let mut exclude = host;
                        if !MagSetWindowFilterList(child, MW_FILTERMODE_EXCLUDE, 1, &mut exclude)
                            .as_bool()
                        {
                            return Err("无法排除放大镜自身".into());
                        }
                        Ok(child)
                    })();
                    match setup {
                        Err(e) => {
                            let _ = tx.send(Err(e));
                        }
                        Ok(child) => {
                            let _ = tx.send(Ok(()));
                            let mut last = POINT {
                                x: i32::MIN,
                                y: i32::MIN,
                            };
                            let mut moved = Instant::now();
                            while !ending.load(Ordering::Relaxed) {
                                let mut msg = MSG::default();
                                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                                    let _ = TranslateMessage(&msg);
                                    DispatchMessageW(&msg);
                                }
                                let mut p = POINT::default();
                                if GetCursorPos(&mut p).is_ok() {
                                    if p != last {
                                        last = p;
                                        moved = Instant::now();
                                    }
                                    if moved.elapsed() < Duration::from_millis(1400) {
                                        let mut monitor = MONITORINFO {
                                            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                                            ..Default::default()
                                        };
                                        if GetMonitorInfoW(
                                            MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST),
                                            &mut monitor,
                                        )
                                        .as_bool()
                                        {
                                            let r = monitor.rcWork;
                                            let x = if p.x + 286 <= r.right {
                                                p.x + 26
                                            } else {
                                                p.x - 286
                                            }
                                            .max(r.left);
                                            let y = if p.y + 206 <= r.bottom {
                                                p.y + 26
                                            } else {
                                                p.y - 206
                                            }
                                            .max(r.top);
                                            let source = RECT {
                                                left: p.x - 65,
                                                top: p.y - 45,
                                                right: p.x + 64,
                                                bottom: p.y + 44,
                                            };
                                            if MagSetWindowSource(child, source).as_bool() {
                                                let _ = SetWindowPos(
                                                    host,
                                                    Some(HWND_TOPMOST),
                                                    x,
                                                    y,
                                                    260,
                                                    180,
                                                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                                );
                                                let _ = InvalidateRect(Some(child), None, false);
                                            } else {
                                                let _ = ShowWindow(host, SW_HIDE);
                                            }
                                        }
                                    } else {
                                        let _ = ShowWindow(host, SW_HIDE);
                                    }
                                } else {
                                    let _ = ShowWindow(host, SW_HIDE);
                                }
                                thread::sleep(Duration::from_millis(33));
                            }
                        }
                    }
                    let _ = DestroyWindow(host);
                }
            }
            let _ = MagUninitialize();
        });
        match rx.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
            }),
            result => {
                stop.store(true, Ordering::Relaxed);
                let _ = thread.join();
                Err(match result {
                    Ok(Err(e)) => e,
                    Err(e) => e.to_string(),
                    _ => unreachable!(),
                })
            }
        }
    }
}
impl Drop for Lens {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

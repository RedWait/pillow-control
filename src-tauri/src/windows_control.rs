use crate::{
    control::Native,
    protocol::{Button, Command, Key, Switch, Volume},
};
use windows::{
    core::GUID,
    Win32::{
        Foundation::POINT,
        Media::Audio::{
            eMultimedia, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator,
            MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
        UI::{
            Input::KeyboardAndMouse::*,
            WindowsAndMessaging::{GetCursorPos, GetForegroundWindow, GetWindowTextW},
        },
    },
};

pub struct WindowsControl {
    alt: bool,
    lens: Option<crate::magnifier::Lens>,
    halo: crate::pointer_halo::Halo,
    last_shutdown: Option<std::time::Instant>,
}
impl WindowsControl {
    pub fn new() -> Result<Self, String> {
        Self::with_store(crate::preferences::Store::memory())
    }
    pub fn with_store(store: crate::preferences::SharedStore) -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|e| e.to_string())?;
        }
        Ok(Self {
            alt: false,
            halo: crate::pointer_halo::Halo::new(store),
            lens: None,
            last_shutdown: None,
        })
    }
    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    dwFlags: if up {
                        KEYEVENTF_KEYUP
                    } else {
                        KEYBD_EVENT_FLAGS(0)
                    },
                    ..Default::default()
                },
            },
        }
    }
    fn send(events: &[INPUT]) -> Result<(), String> {
        unsafe {
            if SendInput(events, std::mem::size_of::<INPUT>() as i32) == events.len() as u32 {
                return Ok(());
            }
            // Release anything that might have been partially inserted before reporting failure.
            for event in events {
                let mut up = *event;
                if up.r#type == INPUT_KEYBOARD {
                    up.Anonymous.ki.dwFlags |= KEYEVENTF_KEYUP;
                } else {
                    let f = up.Anonymous.mi.dwFlags;
                    if f == MOUSEEVENTF_LEFTDOWN {
                        up.Anonymous.mi.dwFlags = MOUSEEVENTF_LEFTUP;
                    } else if f == MOUSEEVENTF_RIGHTDOWN {
                        up.Anonymous.mi.dwFlags = MOUSEEVENTF_RIGHTUP;
                    } else {
                        continue;
                    }
                }
                SendInput(&[up], std::mem::size_of::<INPUT>() as i32);
            }
        }
        Err("Windows 拒绝输入：请检查锁屏、UAC 或管理员窗口".into())
    }
    fn tap(vk: VIRTUAL_KEY) -> Result<(), String> {
        Self::send(&[Self::key(vk, false), Self::key(vk, true)])
    }
    fn mouse(dx: i32, dy: i32, flags: MOUSE_EVENT_FLAGS, data: u32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx,
                    dy,
                    dwFlags: flags,
                    mouseData: data,
                    ..Default::default()
                },
            },
        }
    }
    fn audio() -> Result<IAudioEndpointVolume, String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| e.to_string())?;
            device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())
        }
    }
}
impl Native for WindowsControl {
    fn release(&mut self) -> Result<(), String> {
        if self.alt {
            Self::send(&[Self::key(VK_MENU, true)])?;
            self.alt = false;
        }
        Ok(())
    }
    fn execute(&mut self, command: &Command) -> Result<(), String> {
        command.validate()?;
        if !matches!(command, Command::Switch { .. }) {
            self.release()?;
        }
        match command {
            Command::Move { dx, dy } => {
                Self::send(&[Self::mouse(*dx, *dy, MOUSEEVENTF_MOVE, 0)])?;
                if *dx != 0 || *dy != 0 {
                    self.halo.moved();
                }
                Ok(())
            }
            Command::Click { button, count } => {
                let (down, up) = if *button == Button::Left {
                    (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
                } else {
                    (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
                };
                for i in 0..*count {
                    Self::send(&[Self::mouse(0, 0, down, 0), Self::mouse(0, 0, up, 0)])?;
                    if i == 0 && *count == 2 {
                        std::thread::sleep(std::time::Duration::from_millis(55));
                    }
                }
                Ok(())
            }
            Command::Scroll { dy } => {
                Self::send(&[Self::mouse(0, 0, MOUSEEVENTF_WHEEL, (-*dy) as u32)])
            }
            Command::Key { key } => Self::tap(match key {
                Key::Space => VK_SPACE,
                Key::Left => VK_LEFT,
                Key::Right => VK_RIGHT,
                Key::Up => VK_UP,
                Key::Down => VK_DOWN,
                Key::Enter => VK_RETURN,
                Key::Escape => VK_ESCAPE,
                Key::Backspace => VK_BACK,
            }),
            Command::Desktop {} => Self::send(&[
                Self::key(VK_LWIN, false),
                Self::key(VIRTUAL_KEY(0x44), false),
                Self::key(VIRTUAL_KEY(0x44), true),
                Self::key(VK_LWIN, true),
            ]),
            Command::Text { text } => {
                for unit in text.encode_utf16() {
                    match unit {
                        13 => continue,
                        10 => Self::tap(VK_RETURN)?,
                        9 => Self::tap(VK_TAB)?,
                        _ => {
                            let mut input = Self::key(VIRTUAL_KEY(0), false);
                            input.Anonymous.ki.wScan = unit;
                            input.Anonymous.ki.dwFlags = KEYEVENTF_UNICODE;
                            let mut up = input;
                            unsafe {
                                up.Anonymous.ki.dwFlags |= KEYEVENTF_KEYUP;
                            }
                            Self::send(&[input, up])?;
                        }
                    }
                }
                Ok(())
            }
            Command::Volume { action } => {
                let endpoint = Self::audio()?;
                let context = GUID::zeroed();
                unsafe {
                    match action {
                        Volume::Up => endpoint.VolumeStepUp(&context),
                        Volume::Down => endpoint.VolumeStepDown(&context),
                        Volume::Mute => {
                            let muted = endpoint.GetMute().map_err(|e| e.to_string())?;
                            endpoint.SetMute(!muted.as_bool(), &context)
                        }
                    }
                    .map_err(|e| e.to_string())
                }
            }
            Command::Switch { action } => match action {
                Switch::Confirm => self.release(),
                Switch::Cancel => {
                    Self::tap(VK_ESCAPE)?;
                    self.release()
                }
                Switch::Next | Switch::Previous => {
                    if !self.alt {
                        Self::send(&[Self::key(VK_MENU, false)])?;
                        self.alt = true;
                    }
                    if *action == Switch::Previous {
                        Self::send(&[
                            Self::key(VK_SHIFT, false),
                            Self::key(VK_TAB, false),
                            Self::key(VK_TAB, true),
                            Self::key(VK_SHIFT, true),
                        ])
                    } else {
                        Self::tap(VK_TAB)
                    }
                }
            },
            Command::Magnifier { enabled } => {
                if *enabled && self.lens.is_none() {
                    self.lens = Some(crate::magnifier::Lens::start()?);
                }
                if !enabled {
                    self.lens = None;
                }
                Ok(())
            }
            Command::Shutdown { .. } => {
                if self
                    .last_shutdown
                    .is_some_and(|t| t.elapsed().as_secs() < 30)
                {
                    return Err("关机请求已提交，请查看电脑".into());
                }
                crate::power::shutdown()?;
                self.last_shutdown = Some(std::time::Instant::now());
                Ok(())
            }
            Command::Release {} => self.release(),
        }
    }
    fn end_session(&mut self) -> Result<(), String> {
        let result = self.release();
        self.lens = None;
        self.halo.clear();
        result
    }
    fn probe(&mut self) -> Result<serde_json::Value, String> {
        unsafe {
            let mut p = POINT::default();
            GetCursorPos(&mut p).map_err(|e| e.to_string())?;
            let hwnd = GetForegroundWindow();
            let mut title = [0u16; 512];
            let n = GetWindowTextW(hwnd, &mut title);
            let mut volume = -1.0;
            let mut muted = false;
            if let Ok(endpoint) = Self::audio() {
                volume = endpoint.GetMasterVolumeLevelScalar().unwrap_or(-1.0);
                muted = endpoint.GetMute().map(|v| v.as_bool()).unwrap_or(false);
            }
            Ok(
                serde_json::json!({"x":p.x,"y":p.y,"foreground":hwnd.0 as usize,"title":String::from_utf16_lossy(&title[..n as usize]),"volume":volume,"muted":muted,"altHeld":self.alt,"magnifier":self.lens.is_some(),"halo":self.halo.probe(),"inputSize":std::mem::size_of::<INPUT>()}),
            )
        }
    }
    fn restore_volume(&mut self, value: f32) -> Result<(), String> {
        unsafe {
            Self::audio()?
                .SetMasterVolumeLevelScalar(value.clamp(0.0, 1.0), &GUID::zeroed())
                .map_err(|e| e.to_string())
        }
    }
}
impl Drop for WindowsControl {
    fn drop(&mut self) {
        let _ = self.release();
        unsafe {
            CoUninitialize();
        }
    }
}

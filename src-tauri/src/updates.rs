//! Desktop-only update orchestration. No routes or commands accept URLs or bytes.
use crate::{
    preferences::SharedStore,
    service::{Action, Service},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::FutureExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const RELEASES: &str = "https://github.com/RedWait/pillow-control/releases";
const API: &str = "https://api.github.com/repos/RedWait/pillow-control/releases/latest";
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Distribution {
    Installed,
    Portable,
    Unknown,
}
fn classify(exe: &Path, registered: Option<&Path>) -> Distribution {
    let Some(parent) = exe.parent() else {
        return Distribution::Unknown;
    };
    if parent.join("pillow-portable.json").is_file() {
        return Distribution::Portable;
    }
    if parent.join("uninstall.exe").is_file()
        && registered.is_some_and(|dir| match (parent.canonicalize(), dir.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        })
    {
        Distribution::Installed
    } else {
        Distribution::Unknown
    }
}
pub fn distribution() -> Distribution {
    let Ok(exe) = std::env::current_exe() else {
        return Distribution::Unknown;
    };
    let location = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\枕控 PillowControl")
        .and_then(|key| key.get_value::<String, _>("InstallLocation"))
        .ok();
    classify(
        &exe,
        location.as_deref().map(|p| Path::new(p.trim_matches('"'))),
    )
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub date: String,
    pub notes: String,
    pub can_download: bool,
    pub explanation: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub current_version: String,
    pub startup_check: bool,
    pub distribution: Distribution,
    pub phase: String,
    pub release: Option<ReleaseInfo>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: String,
}
struct Data {
    state: UpdateState,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
pub struct Updates {
    data: Mutex<Data>,
    operation: tokio::sync::Mutex<()>,
    store: SharedStore,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateAction {
    Check,
    Download,
    Install,
    Later,
    Openrelease,
    Startupon,
    Startupoff,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<Asset>,
}
fn newer(current: &str, release: &Release) -> Result<Option<Version>, String> {
    let v = Version::parse(
        release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name),
    )
    .map_err(|_| "发布版本号格式无效")?;
    if release.draft || release.prerelease || !v.pre.is_empty() {
        return Err("发布源未返回稳定版，请打开发布页面查看".into());
    }
    let current = Version::parse(current).map_err(|_| "当前版本号无效")?;
    Ok(v.cmp_precedence(&current).is_gt().then_some(v))
}
pub fn public_key_valid(key: &str) -> bool {
    STANDARD
        .decode(key.trim())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|text| minisign_verify::PublicKey::decode(&text).is_ok())
}
// Release tooling shares the signature format; application downloads still go
// through mandatory verification in the official updater plugin.
pub fn verify_signature(bytes: &[u8], signature: &str, key: &str) -> Result<(), String> {
    let decode = |s: &str| {
        STANDARD
            .decode(s.trim())
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
    };
    let public = decode(key).ok_or("更新公钥无效")?;
    let signature = decode(signature).ok_or("更新签名无效")?;
    let public = minisign_verify::PublicKey::decode(&public).map_err(|_| "更新公钥无效")?;
    let signature = minisign_verify::Signature::decode(&signature).map_err(|_| "更新签名无效")?;
    public
        .verify(bytes, &signature, true)
        .map_err(|_| "更新签名校验失败，已拒绝安装".into())
}
fn bundled_key() -> String {
    serde_json::from_str::<serde_json::Value>(include_str!("../tauri.conf.json"))
        .ok()
        .and_then(|v| {
            v["plugins"]["updater"]["pubkey"]
                .as_str()
                .map(str::to_owned)
        })
        .unwrap_or_default()
}
fn github_client(version: &str) -> Result<updater_http::Client, String> {
    // The official plugin initializes ring during check(), but our API call comes first.
    let _ = rustls::crypto::ring::default_provider().install_default();
    updater_http::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(format!("pillow-control/{version}"))
        .build()
        .map_err(|_| "无法初始化更新连接".into())
}
impl Updates {
    pub fn new(version: String, store: SharedStore) -> Arc<Self> {
        Arc::new(Self {
            data: Mutex::new(Data {
                state: UpdateState {
                    current_version: version,
                    startup_check: true,
                    distribution: distribution(),
                    phase: "idle".into(),
                    release: None,
                    downloaded: 0,
                    total: None,
                    error: String::new(),
                },
                update: None,
                bytes: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            store,
        })
    }
    pub fn snapshot(&self) -> UpdateState {
        let mut state = self.data.lock().unwrap().state.clone();
        state.startup_check = self.store.lock().unwrap().get().updates.startup_check;
        state
    }
    fn edit(&self, edit: impl FnOnce(&mut Data)) {
        edit(&mut self.data.lock().unwrap());
    }
    async fn check(&self, app: &tauri::AppHandle) -> Result<(), String> {
        self.edit(|d| {
            d.state.phase = "checking".into();
            d.state.error.clear();
            d.state.release = None;
            d.update = None;
            d.bytes = None;
            d.state.downloaded = 0;
            d.state.total = None;
        });
        let client = github_client(&self.snapshot().current_version)?;
        let mut response = client
            .get(API)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|_| "无法连接 GitHub，请检查网络后重试")?
            .error_for_status()
            .map_err(|_| "GitHub 暂不可用或请求受限，请稍后重试")?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "更新信息下载中断，请重试")?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err("更新信息超过大小限制".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let release: Release = serde_json::from_slice(&bytes).map_err(|_| "更新信息格式无效")?;
        let Some(version) = newer(&self.snapshot().current_version, &release)? else {
            self.edit(|d| d.state.phase = "latest".into());
            return Ok(());
        };
        let prefix = format!("{RELEASES}/download/{}/", release.tag_name);
        let setup = format!("pillow-control-{version}-setup-x64.exe");
        let asset = |name: &str| {
            release
                .assets
                .iter()
                .find(|a| a.name == name && a.browser_download_url == format!("{prefix}{name}"))
        };
        let mut info = ReleaseInfo {
            version: version.to_string(),
            date: release.published_at.clone().unwrap_or_default(),
            notes: release.body.clone().unwrap_or_default(),
            can_download: false,
            explanation: String::new(),
        };
        let key = bundled_key();
        info.explanation = if self.snapshot().distribution != Distribution::Installed {
            "便携版或未确认的安装位置：请从发布页面下载并手动替换。".into()
        } else if !public_key_valid(&key) {
            "此构建尚未配置更新公钥，请从发布页面下载安装。".into()
        } else if asset("latest.json").is_none()
            || asset(&(setup.clone() + ".sig")).is_none()
            || !asset(&setup).is_some_and(|a| a.size > 0 && a.size <= MAX_DOWNLOAD)
        {
            "此版本未提供完整的签名更新资产，请打开发布页面。".into()
        } else {
            String::new()
        };
        self.edit(|d| {
            d.state.release = Some(info);
            d.state.phase = "available".into();
        });
        if !self.snapshot().release.unwrap().explanation.is_empty() {
            return Ok(());
        }
        // Bind metadata to a particular release, avoiding a moving latest URL.
        let updater = app
            .updater_builder()
            .pubkey(key)
            .target("windows-x86_64")
            .endpoints(vec![format!("{prefix}latest.json")
                .parse()
                .map_err(|_| "更新地址无效")?])
            .map_err(|_| "更新配置无效")?
            .timeout(Duration::from_secs(15))
            .configure_client(|b| b.redirect(updater_http::redirect::Policy::limited(5)))
            // Stop/release inputs ourselves; preserve the UI if ShellExecute fails.
            .on_before_exit(|| {})
            .restart_after_install(false)
            .build()
            .map_err(|_| "更新配置无效")?;
        let update = updater
            .check()
            .await
            .map_err(|_| "签名更新信息读取失败，请重试或打开发布页面")?
            .ok_or("更新元数据与发布版本不一致")?;
        if update.version != version.to_string()
            || update.download_url.as_str() != format!("{prefix}{setup}")
            || update.signature.is_empty()
        {
            return Err("更新元数据与发布资产不一致，已拒绝下载".into());
        }
        self.edit(|d| {
            d.update = Some(update);
            d.state.release.as_mut().unwrap().can_download = true;
        });
        Ok(())
    }
    async fn download(&self) -> Result<(), String> {
        if distribution() != Distribution::Installed {
            return Err("请使用发布页面下载便携版".into());
        }
        let mut update = self
            .data
            .lock()
            .unwrap()
            .update
            .clone()
            .ok_or("请先检查可用更新")?;
        update.timeout = Some(Duration::from_secs(600));
        self.edit(|d| {
            d.state.phase = "downloading".into();
            d.state.error.clear();
            d.state.downloaded = 0;
            d.state.total = None;
            d.bytes = None;
        });
        let too_large = tokio::sync::Notify::new();
        let download = update.download(
            |chunk, total| {
                self.edit(|d| {
                    d.state.downloaded = d.state.downloaded.saturating_add(chunk as u64);
                    d.state.total = total;
                    if d.state.downloaded > MAX_DOWNLOAD || total.is_some_and(|t| t > MAX_DOWNLOAD)
                    {
                        too_large.notify_one();
                    }
                });
            },
            || {},
        );
        let bytes = tokio::select! {
            result = download => result.map_err(|_| "下载失败或签名校验未通过。未安装任何更新，请重试或打开发布页面")?,
            _ = too_large.notified() => return Err("安装包超过大小限制，已取消下载".into()),
        };
        if bytes.len() as u64 > MAX_DOWNLOAD {
            return Err("安装包超过大小限制".into());
        }
        // on_finish runs before signature verification; only Ok(bytes) means ready.
        self.edit(|d| {
            d.bytes = Some(bytes);
            d.state.phase = "ready".into();
        });
        Ok(())
    }
    async fn install(&self, confirmed: bool, service: &Service) -> Result<(), String> {
        if !confirmed {
            return Err("请先确认安装会中断遥控".into());
        }
        if distribution() != Distribution::Installed {
            return Err("当前不是已确认的安装版".into());
        }
        let (update, bytes) = {
            let mut d = self.data.lock().unwrap();
            let update = d.update.clone().ok_or("更新未就绪")?;
            let bytes = d.bytes.take().ok_or("请先下载并验证更新")?;
            (update, bytes)
        };
        verify_signature(&bytes, &update.signature, &bundled_key())?;
        self.edit(|d| d.state.phase = "installing".into());
        service
            .installing_update
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let running = service.snapshot().await.running;
        service.action(Action::Stop, None).await;
        let result = async {
            // Probe queues behind EndSession, confirming held input cleanup.
            service.controller.probe().await?;
            update
                .install(&bytes)
                .map_err(|_| "无法启动安装程序，请重试或打开发布页面".to_string())
        }
        .await;
        // Successful installation exits inside the plugin. Failure remains usable.
        if result.is_err() {
            self.edit(|d| d.bytes = Some(bytes));
            service
                .installing_update
                .store(false, std::sync::atomic::Ordering::SeqCst);
            if running {
                service.action(Action::Start, None).await;
            }
        }
        result
    }
    pub async fn action(
        &self,
        app: &tauri::AppHandle,
        service: &Service,
        action: UpdateAction,
        confirmed: bool,
    ) -> Result<UpdateState, String> {
        let _guard = self
            .operation
            .try_lock()
            .map_err(|_| "更新操作正在进行，请稍候")?;
        let result = match action {
            UpdateAction::Check => {
                match std::panic::AssertUnwindSafe(tokio::time::timeout(
                    Duration::from_secs(35),
                    self.check(app),
                ))
                .catch_unwind()
                .await
                {
                    Ok(Ok(result)) => result,
                    Ok(Err(_)) => Err("检查更新超时，请检查网络后重试".into()),
                    Err(_) => Err("检查更新遇到异常，请重试或打开发布页面".into()),
                }
            }
            UpdateAction::Download => {
                if self.data.lock().unwrap().bytes.is_some() {
                    return Ok(self.snapshot());
                }
                self.download().await
            }
            UpdateAction::Install => self.install(confirmed, service).await,
            UpdateAction::Later => {
                self.edit(|d| {
                    d.state.phase = "idle".into();
                    d.state.release = None;
                    d.state.error.clear();
                    d.update = None;
                    d.bytes = None;
                });
                Ok(())
            }
            UpdateAction::Startupon | UpdateAction::Startupoff => self
                .store
                .lock()
                .unwrap()
                .update(|p| p.updates.startup_check = matches!(action, UpdateAction::Startupon)),
            UpdateAction::Openrelease => open_release(),
        };
        if let Err(error) = result {
            self.edit(|d| {
                d.state.phase = if d.bytes.is_some() { "ready" } else { "error" }.into();
                d.state.error = error;
            });
        }
        Ok(self.snapshot())
    }
}
fn open_release() -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let url: Vec<u16> = RELEASES.encode_utf16().chain(Some(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            None,
            windows::core::w!("open"),
            PCWSTR(url.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        Err("无法打开浏览器，请访问 github.com/RedWait/pillow-control/releases".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
            published_at: None,
            body: None,
            assets: vec![],
        }
    }
    #[test]
    fn api_client_initializes_crypto_before_any_plugin_check() {
        assert!(github_client("0.2.1").is_ok());
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }
    #[test]
    fn stable_semver_never_downgrades() {
        assert!(newer("0.2.1", &release("v0.2.1")).unwrap().is_none());
        assert!(newer("0.2.1", &release("v0.1.9")).unwrap().is_none());
        assert!(newer("0.2.9", &release("v0.2.10")).unwrap().is_some());
        assert!(newer("0.2.1", &release("v0.3.0-beta.1")).is_err());
        let mut r = release("v1.0.0");
        r.draft = true;
        assert!(newer("0.2.1", &r).is_err());
        r.draft = false;
        r.prerelease = true;
        assert!(newer("0.2.1", &r).is_err());
    }
    #[test]
    fn old_settings_default_on_and_opt_out_survives() {
        let mut p: crate::preferences::Preferences = serde_json::from_str("{}").unwrap();
        assert!(p.updates.startup_check);
        p.updates.startup_check = false;
        p.autostart = Some(false);
        let p: crate::preferences::Preferences =
            serde_json::from_slice(&serde_json::to_vec(&p).unwrap()).unwrap();
        assert!(!p.updates.startup_check);
        assert_eq!(p.autostart, Some(false));
    }
    #[test]
    fn malformed_signature_and_key_fail_closed() {
        assert!(!public_key_valid(""));
        assert!(verify_signature(b"exe", "invalid", "invalid").is_err());
    }
    #[tokio::test]
    async fn duplicate_operation_is_rejected() {
        let updates = Updates::new("0.2.1".into(), crate::preferences::Store::memory());
        let _guard = updates.operation.lock().await;
        assert!(updates.operation.try_lock().is_err());
    }
    #[test]
    fn portable_marker_overrides_installer_registration() {
        let dir = std::env::temp_dir().join(format!("pillow-distribution-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("pillow-control.exe");
        assert_eq!(classify(&exe, None), Distribution::Unknown);
        std::fs::write(dir.join("uninstall.exe"), b"fixture").unwrap();
        assert_eq!(classify(&exe, Some(&dir)), Distribution::Installed);
        std::fs::write(dir.join("pillow-portable.json"), b"{}").unwrap();
        assert_eq!(classify(&exe, Some(&dir)), Distribution::Portable);
        std::fs::remove_file(dir.join("pillow-portable.json")).unwrap();
        std::fs::remove_file(dir.join("uninstall.exe")).unwrap();
    }
}

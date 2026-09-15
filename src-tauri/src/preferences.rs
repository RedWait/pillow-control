use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub token_digest: Option<String>,
    pub autostart: Option<bool>,
    pub address: String,
}
pub struct Store {
    data: Preferences,
    path: Option<PathBuf>,
}
pub type SharedStore = Arc<Mutex<Store>>;
impl Store {
    pub fn memory() -> SharedStore {
        Arc::new(Mutex::new(Self {
            data: Preferences::default(),
            path: None,
        }))
    }
    pub fn open(path: PathBuf) -> Result<SharedStore, String> {
        let data: Preferences = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("无法读取已配对设备设置：{e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(e) => return Err(format!("无法读取设置：{e}")),
        };
        if data
            .token_digest
            .as_ref()
            .is_some_and(|d| !crate::protocol::valid_token_shape(d))
        {
            return Err("已配对设备数据损坏，拒绝加载凭证".into());
        }
        Ok(Arc::new(Mutex::new(Self {
            data,
            path: Some(path),
        })))
    }
    pub fn get(&self) -> Preferences {
        self.data.clone()
    }
    pub fn update(&mut self, edit: impl FnOnce(&mut Preferences)) -> Result<(), String> {
        let mut next = self.data.clone();
        edit(&mut next);
        if let Some(path) = &self.path {
            let save = || -> std::io::Result<()> {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let temp = path.with_extension("tmp");
                let mut file = fs::File::create(&temp)?;
                file.write_all(&serde_json::to_vec(&next)?)?;
                file.sync_all()?;
                drop(file);
                fs::rename(temp, path)?;
                Ok(())
            };
            save().map_err(|e| format!("无法保存设置，操作未完成：{e}"))?;
        }
        self.data = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::Pairing;
    fn path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pillow-trust-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn trust_survives_restart_and_revocation_is_durable() {
        let path = path();
        let mut p = Pairing::with_store(Store::open(path.clone()).unwrap()).unwrap();
        let token = p.pair(&p.code.clone()).unwrap().unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains(&token));
        drop(p);
        let store = Store::open(path.clone()).unwrap();
        assert_eq!(store.lock().unwrap().get().autostart, Some(true));
        let mut p = Pairing::with_store(store).unwrap();
        assert!(p.valid(&token));
        p.rotate().unwrap();
        drop(p);
        assert!(!Pairing::with_store(Store::open(path.clone()).unwrap())
            .unwrap()
            .valid(&token));
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn pairing_respects_explicit_autostart_opt_out() {
        let path = path();
        let store = Store::open(path.clone()).unwrap();
        store
            .lock()
            .unwrap()
            .update(|p| p.autostart = Some(false))
            .unwrap();
        let mut p = Pairing::with_store(store.clone()).unwrap();
        p.pair(&p.code.clone()).unwrap().unwrap();
        assert_eq!(
            Store::open(path.clone())
                .unwrap()
                .lock()
                .unwrap()
                .get()
                .autostart,
            Some(false)
        );
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn corrupt_store_and_failed_write_do_not_grant_trust() {
        let path = path();
        fs::write(&path, b"corrupted").unwrap();
        assert!(Store::open(path.clone()).is_err());
        let store = Arc::new(Mutex::new(Store {
            path: Some(path.join("prefs.json")),
            data: Preferences::default(),
        }));
        let mut p = Pairing::with_store(store.clone()).unwrap();
        assert!(p.pair(&p.code.clone()).is_err());
        assert!(store.lock().unwrap().get().token_digest.is_none());
        fs::remove_file(path).unwrap();
    }
}

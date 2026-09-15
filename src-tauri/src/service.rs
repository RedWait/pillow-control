use crate::{
    control::Controller,
    network::{self, Address},
    server::Server,
    windows_control::WindowsControl,
};
use serde::{Deserialize, Serialize};
use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;
#[derive(Clone, Serialize)]
pub struct DesktopState {
    pub running: bool,
    pub connected: bool,
    pub code: String,
    pub addresses: Vec<Address>,
    pub selected: String,
    pub port: u16,
    pub error: String,
    pub autostart: bool,
    pub trusted: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Start,
    Stop,
    Disconnect,
    Pair,
    Quit,
    Autostarton,
    Autostartoff,
}
struct State {
    server: Option<Server>,
    selected: String,
    error: String,
}
pub struct Service {
    state: Mutex<State>,
    pub controller: Arc<Controller>,
    pub exiting: AtomicBool,
    pub store: crate::preferences::SharedStore,
    pub desired_running: AtomicBool,
}
impl Service {
    pub fn new(store: crate::preferences::SharedStore) -> Result<Arc<Self>, String> {
        let controller = Controller::start(|| Ok(Box::new(WindowsControl::new()?)))?;
        let addresses = network::addresses().unwrap_or_default();
        let saved = store.lock().unwrap().get().address;
        let selected = addresses
            .iter()
            .find(|a| a.address == saved)
            .or_else(|| addresses.iter().find(|a| !a.virtual_adapter))
            .map(|a| a.address.clone())
            .unwrap_or_default();
        Ok(Arc::new(Self {
            state: Mutex::new(State {
                server: None,
                selected,
                error: String::new(),
            }),
            controller,
            exiting: AtomicBool::new(false),
            store,
            desired_running: AtomicBool::new(true),
        }))
    }
    pub async fn snapshot(&self) -> DesktopState {
        let addresses = network::addresses();
        let mut state = self.state.lock().await;
        let addresses = match addresses {
            Ok(a) => a,
            Err(e) => {
                state.error = e;
                vec![]
            }
        };
        if state.server.is_some() && !addresses.iter().any(|a| a.address == state.selected) {
            if let Some(mut server) = state.server.take() {
                server.stop().await;
            }
            state.error = "连接地址已变化，请重新选择网卡并启动遥控".into();
        }
        DesktopState {
            running: state.server.is_some(),
            connected: state.server.as_ref().is_some_and(|s| s.context.connected()),
            code: state
                .server
                .as_ref()
                .map(|s| s.context.code())
                .unwrap_or_default(),
            addresses,
            selected: state.selected.clone(),
            port: 19827,
            error: state.error.clone(),
            autostart: false,
            trusted: self.store.lock().unwrap().get().token_digest.is_some(),
        }
    }
    pub async fn action(&self, action: Action, address: Option<String>) -> DesktopState {
        self.action_inner(action, address, false).await
    }
    pub async fn retry_start(&self) -> DesktopState {
        self.action_inner(Action::Start, None, true).await
    }
    async fn action_inner(
        &self,
        action: Action,
        address: Option<String>,
        retry: bool,
    ) -> DesktopState {
        {
            let mut state = self.state.lock().await;
            match action {
                Action::Start => {
                    if !retry {
                        self.desired_running.store(true, Ordering::SeqCst);
                    }
                    if state.server.is_none()
                        && self.desired_running.load(Ordering::SeqCst)
                        && !self.exiting.load(Ordering::SeqCst)
                    {
                        let addresses = network::addresses().unwrap_or_default();
                        if let Some(address) = address {
                            if addresses.iter().any(|a| a.address == address) {
                                state.selected = address;
                            }
                        }
                        if !addresses.iter().any(|a| a.address == state.selected) {
                            state.selected = addresses
                                .iter()
                                .find(|a| !a.virtual_adapter)
                                .map(|a| a.address.clone())
                                .unwrap_or_default();
                        }
                        if !addresses.iter().any(|a| a.address == state.selected) {
                            state.error = "没有可用的局域网 IPv4 地址，请选择网卡".into();
                        } else {
                            let host = state.selected.parse::<Ipv4Addr>().unwrap();
                            match Server::start_with_store(
                                host,
                                19827,
                                self.controller.clone(),
                                self.store.clone(),
                            )
                            .await
                            {
                                Ok(server) => {
                                    state.server = Some(server);
                                    state.error.clear();
                                    if let Err(e) = self
                                        .store
                                        .lock()
                                        .unwrap()
                                        .update(|p| p.address = state.selected.clone())
                                    {
                                        state.error = e;
                                    }
                                }
                                Err(error) => state.error = error,
                            }
                        }
                    }
                }
                Action::Stop | Action::Quit => {
                    self.desired_running.store(false, Ordering::SeqCst);
                    if matches!(action, Action::Quit) {
                        self.exiting.store(true, Ordering::SeqCst);
                    }
                    if let Some(mut server) = state.server.take() {
                        server.stop().await;
                    }
                    self.controller.revoke();
                }
                Action::Autostarton | Action::Autostartoff => {}
                Action::Pair | Action::Disconnect => {
                    let result = if let Some(server) = state.server.as_ref() {
                        server.context.revoke()
                    } else {
                        self.store.lock().unwrap().update(|p| p.token_digest = None)
                    };
                    if let Err(error) = result {
                        state.error = error;
                    }
                }
            }
        }
        self.snapshot().await
    }
    pub async fn shutdown(&self) {
        self.action(Action::Quit, None).await;
        self.controller.shutdown();
    }
}

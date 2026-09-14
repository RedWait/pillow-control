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
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Start,
    Stop,
    Disconnect,
    Pair,
    Quit,
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
}
impl Service {
    pub fn new() -> Result<Arc<Self>, String> {
        let controller = Controller::start(|| Ok(Box::new(WindowsControl::new()?)))?;
        let addresses = network::addresses().unwrap_or_default();
        let selected = addresses
            .iter()
            .find(|a| !a.virtual_adapter)
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
        }
    }
    pub async fn action(&self, action: Action, address: Option<String>) -> DesktopState {
        {
            let mut state = self.state.lock().await;
            match action {
                Action::Start => {
                    if state.server.is_none() && !self.exiting.load(Ordering::SeqCst) {
                        let addresses = network::addresses().unwrap_or_default();
                        if let Some(address) = address {
                            if addresses.iter().any(|a| a.address == address) {
                                state.selected = address;
                            }
                        }
                        if !addresses.iter().any(|a| a.address == state.selected) {
                            state.error = "没有可用的局域网 IPv4 地址，请选择网卡".into();
                        } else {
                            let host = state.selected.parse::<Ipv4Addr>().unwrap();
                            match Server::start(host, 19827, self.controller.clone()).await {
                                Ok(server) => {
                                    state.server = Some(server);
                                    state.error.clear();
                                }
                                Err(error) => state.error = error,
                            }
                        }
                    }
                }
                Action::Stop | Action::Quit => {
                    if matches!(action, Action::Quit) {
                        self.exiting.store(true, Ordering::SeqCst);
                    }
                    if let Some(mut server) = state.server.take() {
                        server.stop().await;
                    }
                    self.controller.revoke();
                }
                Action::Pair | Action::Disconnect => {
                    if let Some(server) = state.server.as_ref() {
                        if let Err(error) = server.context.revoke() {
                            state.error = error;
                        }
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

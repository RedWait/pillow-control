use serde::Serialize;
use std::net::Ipv4Addr;
use windows::Win32::{
    Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR},
    NetworkManagement::{IpHelper::*, Ndis::IfOperStatusUp},
    Networking::WinSock::{AF_INET, SOCKADDR_IN},
};
#[derive(Debug, Clone, Serialize)]
pub struct Address {
    pub name: String,
    pub address: String,
    #[serde(rename = "virtual")]
    pub virtual_adapter: bool,
}
pub fn addresses() -> Result<Vec<Address>, String> {
    unsafe {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        let mut size = 15_000u32;
        for _ in 0..3 {
            // The SDK structure includes u64 fields; byte vectors alone do not guarantee alignment.
            let mut storage = vec![0u64; size as usize / 8 + 1];
            let head = storage.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            let result = GetAdaptersAddresses(AF_INET.0 as u32, flags, None, Some(head), &mut size);
            if result == ERROR_BUFFER_OVERFLOW.0 {
                continue;
            }
            if result != NO_ERROR.0 {
                return Err(format!("无法枚举 Windows 网卡：{result}"));
            }
            let mut result = vec![];
            let mut adapter = head;
            while !adapter.is_null() {
                let item = &*adapter;
                if item.OperStatus == IfOperStatusUp && item.IfType != 24 {
                    let name = item
                        .FriendlyName
                        .to_string()
                        .unwrap_or_else(|_| "未知网卡".into());
                    let mut row = MIB_IF_ROW2 {
                        InterfaceLuid: item.Luid,
                        ..Default::default()
                    };
                    let physical = GetIfEntry2(&mut row) == NO_ERROR
                        && row.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
                    let lower = name.to_lowercase();
                    let virtual_adapter = !physical
                        || [
                            "virtual", "vpn", "wsl", "docker", "tun", "tap", "vmware", "vbox",
                        ]
                        .iter()
                        .any(|part| lower.contains(part));
                    let mut unicast = item.FirstUnicastAddress;
                    while !unicast.is_null() {
                        let address = &*unicast;
                        if !address.Address.lpSockaddr.is_null()
                            && (*address.Address.lpSockaddr).sa_family == AF_INET
                        {
                            let socket = &*(address.Address.lpSockaddr.cast::<SOCKADDR_IN>());
                            let ip = Ipv4Addr::from(socket.sin_addr.S_un.S_addr.to_ne_bytes());
                            if !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() {
                                result.push(Address {
                                    name: name.clone(),
                                    address: ip.to_string(),
                                    virtual_adapter,
                                });
                            }
                        }
                        unicast = address.Next;
                    }
                }
                adapter = item.Next;
            }
            result.sort_by_key(|a| a.virtual_adapter);
            return Ok(result);
        }
        Err("网卡地址持续变化，请稍后重试".into())
    }
}

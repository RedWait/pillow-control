use windows::{
    core::w,
    Win32::{
        Foundation::*,
        Security::*,
        System::{Shutdown::*, Threading::*},
    },
};

// Intentionally excludes FORCE and FORCEIFHUNG. Windows owns save prompts and cancellation.
const FLAGS: EXIT_WINDOWS_FLAGS = EWX_POWEROFF;
const REASON: SHUTDOWN_REASON = SHUTDOWN_REASON(
    SHTDN_REASON_MAJOR_APPLICATION.0 | SHTDN_REASON_MINOR_OTHER.0 | SHTDN_REASON_FLAG_PLANNED.0,
);
pub fn shutdown() -> Result<(), String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut token,
        )
        .map_err(|e| e.to_string())?;
        let result = (|| {
            let mut luid = LUID::default();
            LookupPrivilegeValueW(None, w!("SeShutdownPrivilege"), &mut luid)
                .map_err(|e| e.to_string())?;
            let request = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            let mut previous = TOKEN_PRIVILEGES::default();
            let mut length = 0;
            AdjustTokenPrivileges(
                token,
                false,
                Some(&request),
                std::mem::size_of::<TOKEN_PRIVILEGES>() as u32,
                Some(&mut previous),
                Some(&mut length),
            )
            .map_err(|e| e.to_string())?;
            if GetLastError() == ERROR_NOT_ALL_ASSIGNED {
                return Err("当前 Windows 用户没有关机权限".into());
            }
            let result =
                ExitWindowsEx(FLAGS, REASON).map_err(|e| format!("Windows 未接受关机请求：{e}"));
            let _ = AdjustTokenPrivileges(token, false, Some(&previous), 0, None, None);
            result
        })();
        let _ = CloseHandle(token);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_never_forces_unsaved_apps() {
        assert_eq!(FLAGS.0 & (EWX_FORCE.0 | EWX_FORCEIFHUNG.0), 0);
        assert_ne!(FLAGS.0 & EWX_POWEROFF.0, 0);
        assert_ne!(REASON.0 & SHTDN_REASON_FLAG_PLANNED.0, 0);
    }
}

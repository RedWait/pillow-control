import { invoke } from "@tauri-apps/api/core";
import type { DesktopState } from "../../shared/protocol";
export const desktop = {
  state: () => invoke<DesktopState>("desktop_state"),
  action: (action: string, address?: string) =>
    invoke<DesktopState>("desktop_action", { action, address }),
  subscribe: (callback: (state: DesktopState) => void) => {
    let closed = false,
      busy = false;
    const timer = setInterval(async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const state = await desktop.state();
        if (!closed) callback(state);
      } catch {
      } finally {
        busy = false;
      }
    }, 1000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  },
};

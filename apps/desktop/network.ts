import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
let hardware = new Map<string, boolean>();
export async function inspectAdapters() {
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; @(Get-NetAdapter -IncludeHidden | Select-Object Name,HardwareInterface) | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024 },
    );
    const data = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    hardware = new Map(
      (Array.isArray(data) ? data : [data]).map(
        (a: { Name: string; HardwareInterface: boolean }) => [
          a.Name,
          a.HardwareInterface,
        ],
      ),
    );
  } catch {
    hardware.clear();
  }
}
export function addresses() {
  return Object.entries(networkInterfaces())
    .flatMap(([name, list]) =>
      (list || [])
        .filter(
          (a) =>
            a.family === "IPv4" &&
            !a.internal &&
            !a.address.startsWith("169.254."),
        )
        .map((a) => ({
          name: hardware.has(name) ? name : `${name}（网卡类型未确认）`,
          address: a.address,
          virtual:
            hardware.get(name) !== true ||
            /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|vpn|tun|tap|clash|loopback/i.test(
              name,
            ),
        })),
    )
    .sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

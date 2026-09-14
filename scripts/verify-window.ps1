param([Parameter(Mandatory=$true)][int]$TargetProcessId, [ValidateSet('state','close','minimize')][string]$Action='state')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PillowWindowTest {
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int command);
 public static IntPtr Find(int pid){IntPtr found=IntPtr.Zero;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);var s=new StringBuilder(512);GetWindowText(h,s,512);if(p==pid && s.ToString().Contains("PillowControl")){found=h;return false;}return true;},IntPtr.Zero);return found;}
}
'@
$windowHandle=[PillowWindowTest]::Find($TargetProcessId)
if($windowHandle -eq [IntPtr]::Zero){throw 'Owned PillowControl window not found'}
if($Action -eq 'close'){[PillowWindowTest]::PostMessage($windowHandle,0x10,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null}
if($Action -eq 'minimize'){[PillowWindowTest]::ShowWindow($windowHandle,6)|Out-Null}
@{handle=$windowHandle.ToInt64();visible=[PillowWindowTest]::IsWindowVisible($windowHandle);minimized=[PillowWindowTest]::IsIconic($windowHandle)} | ConvertTo-Json -Compress

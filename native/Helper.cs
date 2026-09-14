using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Windows-only, private stdin/stdout transport. Never listens on the network.
class Helper {
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text,int count);
  static readonly object gate = new object();
  static bool alt;
  static DateTime last = DateTime.UtcNow;
  static JavaScriptSerializer json = new JavaScriptSerializer();
  static void Send(params INPUT[] input) { if(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(INPUT))) != input.Length) {
    // Even partial insertion must not leave a key or mouse button down.
    foreach(var item in input){var up=item;if(item.type==1){up.u.ki.flags|=2;SendInput(1,new[]{up},Marshal.SizeOf(typeof(INPUT)));}else if(item.u.mi.dwFlags==2||item.u.mi.dwFlags==8){up.u.mi.dwFlags*=2;SendInput(1,new[]{up},Marshal.SizeOf(typeof(INPUT)));}}
    throw new Exception("Windows 拒绝输入：请检查焦点、锁屏或管理员窗口（UIPI）。"); }
  }
  static INPUT K(ushort vk, bool up) { return new INPUT {type=1,u=new UNION{ki=new KEYBDINPUT{vk=vk,flags=up?2u:0u}}}; }
  static void Key(ushort vk) { Send(K(vk,false),K(vk,true)); }
  static void Mouse(int dx,int dy,uint flags,uint data) { Send(new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{dx=dx,dy=dy,dwFlags=flags,mouseData=data}}}); }
  static void Release() { if(alt) { Send(K(0x12,true)); alt=false; } }
  static string S(Dictionary<string,object> c,string key) {return Convert.ToString(c[key]);}
  static int N(Dictionary<string,object> c,string key) {return Convert.ToInt32(c[key]);}
  static object Execute(Dictionary<string,object> c) {
    string type=S(c,"type");
    if(type!="switch" && type!="probe" && type!="keepalive") Release();
    switch(type) {
      case "move": Mouse(Math.Max(-500,Math.Min(500,N(c,"dx"))),Math.Max(-500,Math.Min(500,N(c,"dy"))),1,0); break;
      case "click":
        uint down=S(c,"button")=="right"?8u:2u;
        for(int i=0;i<Math.Min(2,N(c,"count"));i++) { Send(new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{dwFlags=down}}},new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{dwFlags=down*2}}}); if(i==0 && N(c,"count")==2) Thread.Sleep(55); } break;
      case "scroll": Mouse(0,0,0x800,unchecked((uint)-N(c,"dy"))); break;
      case "key":
        var keys=new Dictionary<string,ushort>{{"space",0x20},{"left",0x25},{"right",0x27},{"up",0x26},{"down",0x28},{"enter",0x0d},{"escape",0x1b}};
        Key(keys[S(c,"key")]); break;
      case "volume":
        WithAudio(delegate(IAudioEndpointVolume v){ Guid g=Guid.Empty; string a=S(c,"action"); if(a=="up") Marshal.ThrowExceptionForHR(v.VolumeStepUp(ref g)); else if(a=="down") Marshal.ThrowExceptionForHR(v.VolumeStepDown(ref g)); else {bool mute; Marshal.ThrowExceptionForHR(v.GetMute(out mute)); Marshal.ThrowExceptionForHR(v.SetMute(!mute,ref g));} }); break;
      case "switch":
        string action=S(c,"action");
        if(action=="confirm") Release();
        else if(action=="cancel") {Key(0x1b); Release();}
        else { if(!alt){Send(K(0x12,false));alt=true;} if(action=="previous") Send(K(0x10,false)); try{Key(0x09);}finally{if(action=="previous")Send(K(0x10,true));} } break;
      case "desktop": Send(K(0x5b,false),K(0x44,false),K(0x44,true),K(0x5b,true)); break;
      case "text":
        string text=S(c,"text"); if(text.Length>1000) throw new Exception("文字太长");
        foreach(char ch in text) { if(ch=='\r') continue; if(ch=='\n'){Key(0x0d);continue;} if(ch=='\t'){Key(0x09);continue;}
          Send(new INPUT{type=1,u=new UNION{ki=new KEYBDINPUT{scan=ch,flags=4}}},new INPUT{type=1,u=new UNION{ki=new KEYBDINPUT{scan=ch,flags=6}}});
        } break;
      case "release": Release(); break;
      case "keepalive": break;
      case "restore-volume": WithAudio(delegate(IAudioEndpointVolume v){Guid g=Guid.Empty;Marshal.ThrowExceptionForHR(v.SetMasterVolumeLevelScalar(Math.Max(0,Math.Min(1,Convert.ToSingle(c["value"]))),ref g));});break;
      case "probe":
        POINT p; GetCursorPos(out p); var title=new StringBuilder(512); var hwnd=GetForegroundWindow();GetWindowText(hwnd,title,512);
        float level=-1;bool muted=false;
        try{WithAudio(delegate(IAudioEndpointVolume v){Marshal.ThrowExceptionForHR(v.GetMasterVolumeLevelScalar(out level));Marshal.ThrowExceptionForHR(v.GetMute(out muted));});}catch{}
        return new {x=p.x,y=p.y,foreground=hwnd.ToInt64(),title=title.ToString(),volume=level,muted=muted,altHeld=alt,inputSize=Marshal.SizeOf(typeof(INPUT))};
      default: throw new Exception("不支持的指令");
    }
    return null;
  }
  [STAThread] static void Main() {
    Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
    using(var timer=new Timer(delegate{lock(gate){if((DateTime.UtcNow-last).TotalSeconds>3)try{Release();}catch{}}},null,500,500)) {
      try { string line; while((line=Console.ReadLine())!=null) { object id=null; try {if(line.Length>16384)throw new Exception("消息太大");var c=json.Deserialize<Dictionary<string,object>>(line);id=c["id"];object result;lock(gate){last=DateTime.UtcNow;result=Execute(c);}Console.WriteLine(json.Serialize(new{id=id,ok=true,result=result}));}catch(Exception e){try{lock(gate)Release();}catch{}Console.WriteLine(json.Serialize(new{id=id,ok=false,error=e.Message}));} } }
      finally {lock(gate)try{Release();}catch{}}
    }
  }
  static void WithAudio(Action<IAudioEndpointVolume> action) {
    object enumerator=new MMDeviceEnumerator(); IMMDevice device=null;object endpoint=null;
    try {Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)enumerator).GetDefaultAudioEndpoint(0,1,out device));Guid iid=typeof(IAudioEndpointVolume).GUID;Marshal.ThrowExceptionForHR(device.Activate(ref iid,23,IntPtr.Zero,out endpoint));action((IAudioEndpointVolume)endpoint);}
    finally {if(endpoint!=null)Marshal.ReleaseComObject(endpoint);if(device!=null)Marshal.ReleaseComObject(device);Marshal.ReleaseComObject(enumerator);}
  }
  [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
    [PreserveSig]int EnumAudioEndpoints(int flow,int mask,out IntPtr devices);
    [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice device);
  }
  [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
    [PreserveSig]int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object instance);
  }
  [ComImport,Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume {
    [PreserveSig]int RegisterControlChangeNotify(IntPtr p);[PreserveSig]int UnregisterControlChangeNotify(IntPtr p);
    [PreserveSig]int GetChannelCount(out uint count);
    [PreserveSig]int SetMasterVolumeLevel(float level,ref Guid context);[PreserveSig]int SetMasterVolumeLevelScalar(float level,ref Guid context);
    [PreserveSig]int GetMasterVolumeLevel(out float level);[PreserveSig]int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig]int SetChannelVolumeLevel(uint channel,float level,ref Guid context);[PreserveSig]int SetChannelVolumeLevelScalar(uint channel,float level,ref Guid context);
    [PreserveSig]int GetChannelVolumeLevel(uint channel,out float level);[PreserveSig]int GetChannelVolumeLevelScalar(uint channel,out float level);
    [PreserveSig]int SetMute([MarshalAs(UnmanagedType.Bool)]bool mute,ref Guid context);[PreserveSig]int GetMute([MarshalAs(UnmanagedType.Bool)]out bool mute);
    [PreserveSig]int GetVolumeStepInfo(out uint step,out uint count);[PreserveSig]int VolumeStepUp(ref Guid context);[PreserveSig]int VolumeStepDown(ref Guid context);
  }
}

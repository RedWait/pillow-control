using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using System.Web.Script.Serialization;
class VerificationHost {
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern uint GetClipboardSequenceNumber();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr hwnd,out RECT r);
 [DllImport("user32.dll")]static extern int GetWindowLong(IntPtr hwnd,int index);
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")]static extern bool GetPhysicalCursorPos(out Point p);
 [DllImport("user32.dll")]static extern bool SetPhysicalCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)]struct RECT{public int left,top,right,bottom;}
 static int wheel;
 static Form[] forms=new Form[3];static int clicks;static Button button;static JavaScriptSerializer json=new JavaScriptSerializer();static IntPtr notepad;
 [STAThread]static void Main(){SetProcessDpiAwarenessContext(new IntPtr(-4));Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  for(int i=0;i<3;i++){forms[i]=new Form{Text="PillowControl verification "+i,Size=new Size(420,260),StartPosition=FormStartPosition.Manual,Location=new Point(100+i*35,100+i*35)};forms[i].Show();}
  forms[0].Size=new Size(900,600);
  button=new Button{Text="Click verification target",Dock=DockStyle.Fill};button.Click+=(s,e)=>clicks++;button.MouseWheel+=(s,e)=>wheel+=e.Delta;forms[0].Controls.Add(button);
  new Thread(()=>{string line;while((line=Console.ReadLine())!=null){try{var command=line;object result=forms[0].Invoke(new Func<object>(()=>Execute(command)));Console.WriteLine(json.Serialize(new{ok=true,result=result}));if(command=="close")break;}catch(Exception e){Console.WriteLine(json.Serialize(new{ok=false,error=e.Message}));}}try{if(!forms[0].IsDisposed)forms[0].BeginInvoke(new Action(()=>{forms[1].Close();forms[2].Close();forms[0].Close();}));}catch{}}){IsBackground=true}.Start();
  Application.Run(forms[0]);
 }
 static object Execute(string command){
  if(command=="lens-screenshot"){string file=Path.Combine(Environment.CurrentDirectory,"artifacts","pointer-magnifier.png");using(var bmp=new Bitmap(forms[0].Width,forms[0].Height)){using(var g=Graphics.FromImage(bmp)){g.CopyFromScreen(forms[0].Location,Point.Empty,bmp.Size);}bmp.Save(file,System.Drawing.Imaging.ImageFormat.Png);}return file;}
  if(command=="halo"){var h=FindWindow("STATIC","PillowControl pointer halo");RECT r;GetWindowRect(h,out r);Point p;GetPhysicalCursorPos(out p);return new{exists=h!=IntPtr.Zero,visible=IsWindowVisible(h),left=r.left,top=r.top,width=r.right-r.left,height=r.bottom-r.top,x=p.X,y=p.Y,hit=WindowFromPoint(p).ToInt64(),strokeHit=WindowFromPoint(new Point(p.X+(r.right-r.left)/2-5,p.Y)).ToInt64(),hwnd=h.ToInt64(),style=GetWindowLong(h,-20),foreground=GetForegroundWindow().ToInt64()};}
  if(command=="edge")return SetPhysicalCursorPos(Screen.PrimaryScreen.Bounds.Left,Screen.PrimaryScreen.Bounds.Top);
  if(command=="target-cursor"){var p=button.PointToScreen(new Point(button.Width/2,button.Height/2));return SetPhysicalCursorPos(p.X,p.Y);}
  if(command=="local-move"){Point p;GetPhysicalCursorPos(out p);return SetPhysicalCursorPos(p.X+8,p.Y+4);}
  if(command=="maximize"){forms[0].WindowState=FormWindowState.Maximized;forms[0].BringToFront();SetForegroundWindow(forms[0].Handle);return true;}
  if(command=="borderless"){forms[0].WindowState=FormWindowState.Normal;forms[0].FormBorderStyle=FormBorderStyle.None;forms[0].Bounds=Screen.FromControl(forms[0]).Bounds;forms[0].BringToFront();SetForegroundWindow(forms[0].Handle);return true;}
  if(command=="normal"){forms[0].WindowState=FormWindowState.Normal;forms[0].FormBorderStyle=FormBorderStyle.Sizable;forms[0].Size=new Size(900,600);forms[0].Location=new Point(100,100);return true;}
  if(command.StartsWith("screen-")){int n=int.Parse(command.Substring(7));var r=Screen.AllScreens[n].Bounds;return SetPhysicalCursorPos(r.Left+r.Width/2,r.Top+r.Height/2);}
  if(command=="screens")return Array.ConvertAll(Screen.AllScreens,s=>new{x=s.Bounds.X,y=s.Bounds.Y,width=s.Bounds.Width,height=s.Bounds.Height,primary=s.Primary});
  if(command=="halo-screenshot"){string file=Path.Combine(Environment.CurrentDirectory,"artifacts","pointer-halo.png");var rect=forms[0].RectangleToScreen(forms[0].ClientRectangle);using(var bmp=new Bitmap(rect.Width,rect.Height)){using(var g=Graphics.FromImage(bmp)){g.CopyFromScreen(rect.Location,Point.Empty,bmp.Size);}bmp.Save(file,System.Drawing.Imaging.ImageFormat.Png);}return file;}
  if(command=="wheel")return wheel;
  if(command=="lens"){var hwnd=FindWindow("STATIC","PillowControl pointer magnifier");return new{exists=hwnd!=IntPtr.Zero,visible=IsWindowVisible(hwnd),foreground=GetForegroundWindow().ToInt64()};}
  if(command=="clipboard-sequence")return GetClipboardSequenceNumber();
  if(command=="focus-notepad"){if(notepad==IntPtr.Zero)throw new Exception("No test Notepad captured");return SetForegroundWindow(notepad);}
  if(command=="target"){foreach(var f in forms){f.BringToFront();SetForegroundWindow(f.Handle);}forms[0].TopMost=true;forms[0].BringToFront();SetForegroundWindow(forms[0].Handle);var p=button.PointToScreen(new Point(button.Width/2,button.Height/2));return new{x=p.X,y=p.Y,hwnd=forms[0].Handle.ToInt64()};}
  if(command=="untop"){forms[0].TopMost=false;return true;}
  if(command=="clicks"){forms[0].TopMost=false;return clicks;}
  if(command=="windows")return new[]{forms[0].Handle.ToInt64(),forms[1].Handle.ToInt64(),forms[2].Handle.ToInt64()};
  if(command=="notepad") {string file=Path.Combine(Path.GetTempPath(),"pillow-control-chinese-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".txt");File.WriteAllText(file,"",new UTF8Encoding(false));Process.Start("notepad.exe","\""+file+"\"");return file;}
  if(command=="read-notepad") {notepad=GetForegroundWindow();var root=AutomationElement.FromHandle(notepad);var items=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);string text="";double area=-1;for(int i=0;i<items.Count;i++){object pattern;var c=items[i].Current;var rect=c.BoundingRectangle;if(!c.IsOffscreen && (c.ControlType==ControlType.Document || c.ControlType==ControlType.Edit) && rect.Width*rect.Height>area && items[i].TryGetCurrentPattern(TextPattern.Pattern,out pattern)){text=((TextPattern)pattern).DocumentRange.GetText(4096);area=rect.Width*rect.Height;}}if(area<0)throw new Exception("No visible Notepad editor");return new{hwnd=notepad.ToInt64(),name=root.Current.Name,text=text.ToString()};}
  if(command=="close"){forms[1].Close();forms[2].Close();forms[0].BeginInvoke(new Action(()=>forms[0].Close()));return true;}
  throw new Exception("Unknown test action");
 }
}

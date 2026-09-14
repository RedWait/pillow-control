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
 static Form[] forms=new Form[3];static int clicks;static Button button;static JavaScriptSerializer json=new JavaScriptSerializer();static IntPtr notepad;
 [STAThread]static void Main(){Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  for(int i=0;i<3;i++){forms[i]=new Form{Text="PillowControl verification "+i,Size=new Size(420,260),StartPosition=FormStartPosition.Manual,Location=new Point(100+i*35,100+i*35)};forms[i].Show();}
  button=new Button{Text="Click verification target",Dock=DockStyle.Fill};button.Click+=(s,e)=>clicks++;forms[0].Controls.Add(button);
  new Thread(()=>{string line;while((line=Console.ReadLine())!=null){try{var command=line;object result=forms[0].Invoke(new Func<object>(()=>Execute(command)));Console.WriteLine(json.Serialize(new{ok=true,result=result}));if(command=="close")break;}catch(Exception e){Console.WriteLine(json.Serialize(new{ok=false,error=e.Message}));}}try{if(!forms[0].IsDisposed)forms[0].BeginInvoke(new Action(()=>{forms[1].Close();forms[2].Close();forms[0].Close();}));}catch{}}){IsBackground=true}.Start();
  Application.Run(forms[0]);
 }
 static object Execute(string command){
  if(command=="target"){foreach(var f in forms){f.BringToFront();SetForegroundWindow(f.Handle);}forms[0].TopMost=true;forms[0].BringToFront();SetForegroundWindow(forms[0].Handle);var p=button.PointToScreen(new Point(button.Width/2,button.Height/2));return new{x=p.X,y=p.Y,hwnd=forms[0].Handle.ToInt64()};}
  if(command=="untop"){forms[0].TopMost=false;return true;}
  if(command=="clicks"){forms[0].TopMost=false;return clicks;}
  if(command=="windows")return new[]{forms[0].Handle.ToInt64(),forms[1].Handle.ToInt64(),forms[2].Handle.ToInt64()};
  if(command=="notepad") {string file=Path.Combine(Path.GetTempPath(),"pillow-control-chinese-"+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".txt");File.WriteAllText(file,"",new UTF8Encoding(false));Process.Start("notepad.exe","\""+file+"\"");return file;}
  if(command=="read-notepad") {notepad=GetForegroundWindow();var root=AutomationElement.FromHandle(notepad);var items=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);var text=new StringBuilder();for(int i=0;i<items.Count;i++){object pattern;if(items[i].TryGetCurrentPattern(TextPattern.Pattern,out pattern))text.Append(((TextPattern)pattern).DocumentRange.GetText(4096));}return new{hwnd=notepad.ToInt64(),name=root.Current.Name,text=text.ToString()};}
  if(command=="close"){forms[1].Close();forms[2].Close();forms[0].BeginInvoke(new Action(()=>forms[0].Close()));return true;}
  throw new Exception("Unknown test action");
 }
}

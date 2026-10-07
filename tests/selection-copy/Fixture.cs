// Standalone interactive Windows fixture; compiled as msedge.exe to exercise the
// production helper's fixed process-name policy without adding a production test bypass.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LightTranslate.SelectionCopy.Tests
{
    internal sealed class FixtureForm : Form
    {
        internal const string Expected = "Text-controlled selection keeps  two spaces.\r\nNext line: αβ 中文.";
        internal bool IgnoreCopy;
        internal int CopyCount;
        internal readonly TextBox Editor = new TextBox { Multiline = true, Dock = DockStyle.Fill, Text = Expected };
        internal FixtureForm()
        {
            Text = "LightTranslate isolated clipboard test fixture";
            Width = 580; Height = 210; KeyPreview = true;
            Controls.Add(new Label { Text = "Fixed test text only. Clipboard will be restored when testing ends.", Dock = DockStyle.Top, Height = 70 });
            Controls.Add(Editor);
            KeyDown += delegate(object sender, KeyEventArgs e)
            {
                if (e.Control && e.KeyCode == Keys.C)
                {
                    CopyCount++;
                    if (IgnoreCopy) { e.Handled = true; e.SuppressKeyPress = true; }
                }
            };
        }
    }

    internal static class EntryPoint
    {
        private static string helper;
        private static string report;
        private static int passed;
        private static uint lastOwnedSequence;
        private static readonly List<string> results = new List<string>();
        private static readonly JavaScriptSerializer json = new JavaScriptSerializer();
        [STAThread]
        private static int Main(string[] args)
        {
            if (args[0] == "inspect-bitmap")
            {
                using (HiddenOwner owner = new HiddenOwner())
                using (new ClipboardLock(owner.Handle, 350))
                {
                    IntPtr bitmap = Native.GetClipboardData(Native.CF_BITMAP);
                    Native.Bitmap details;
                    int size = Native.GetObject(bitmap, Marshal.SizeOf(typeof(Native.Bitmap)), out details);
                    File.WriteAllText(args[1], json.Serialize(new { handlePresent = bitmap != IntPtr.Zero, objectSize = size, width = details.Width, height = details.Height, dibPresent = Native.GetClipboardData(8) != IntPtr.Zero }));
                }
                return 0;
            }
            helper = args[0]; report = args[1];
            Application.EnableVisualStyles();
            FixtureForm form = new FixtureForm();
            form.Shown += async delegate { await Run(form); form.Close(); };
            Application.Run(form);
            return results.Exists(value => value.StartsWith("FAIL")) ? 1 : 0;
        }
        private static void Assert(bool value, string name) { if (!value) throw new Exception(name); }
        private static void Pass(string name) { results.Add("PASS " + name); passed++; }
        private static void Track() { lastOwnedSequence = Native.GetClipboardSequenceNumber(); }
        private static void Baseline(bool includeBitmap = false)
        {
            using (HiddenOwner owner = new HiddenOwner())
            using (new ClipboardLock(owner.Handle, 350))
            using (Bitmap image = new Bitmap(4, 3))
            {
                Native.EmptyClipboard();
                PutBytes(Native.CF_UNICODETEXT, Encoding.Unicode.GetBytes("original fixed text  double spaces\r\nline two\0"));
                PutBytes(Native.RegisterClipboardFormat("HTML Format"), Encoding.UTF8.GetBytes("<html><body><b>fixed HTML</b></body></html>\0"));
                image.SetPixel(1, 1, Color.FromArgb(255, 11, 99, 177));
                if (includeBitmap)
                {
                    IntPtr bitmap = image.GetHbitmap();
                    if (Native.SetClipboardData(Native.CF_BITMAP, bitmap) == IntPtr.Zero) { Native.DeleteObject(bitmap); throw new Exception("fixture bitmap set failed"); }
                }
            }
            Track();
        }
        private static void PutBytes(uint format, byte[] bytes)
        {
            IntPtr handle = Native.GlobalAlloc(2, (UIntPtr)(uint)bytes.Length);
            IntPtr pointer = Native.GlobalLock(handle);
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            Native.GlobalUnlock(handle);
            if (Native.SetClipboardData(format, handle) == IntPtr.Zero) { Native.GlobalFree(handle); throw new Exception("fixture bytes set failed"); }
        }
        private static void CheckBaseline(bool includeBitmap = false)
        {
            Assert(Clipboard.GetText(TextDataFormat.UnicodeText) == "original fixed text  double spaces\r\nline two", "text preserved");
            Assert(Clipboard.GetText(TextDataFormat.Html) == "<html><body><b>fixed HTML</b></body></html>", "HTML preserved");
            if (includeBitmap) using (Image image = Clipboard.GetImage())
            {
                Assert(image != null && image.Width == 4 && image.Height == 3, "bitmap dimensions preserved (" + (image == null ? "null" : image.Width + "x" + image.Height) + ")");
                using (Bitmap bitmap = new Bitmap(image)) Assert(bitmap.GetPixel(1, 1).ToArgb() == Color.FromArgb(255, 11, 99, 177).ToArgb(), "bitmap pixel preserved");
            }
        }
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        private static async Task Focus(Form form)
        {
            bool activated = false;
            for (int attempt = 0; attempt < 5 && Native.GetForegroundWindow() != form.Handle; attempt++)
            {
                form.Show(); ShowWindow(form.Handle, 5); form.BringToFront(); form.Activate(); activated = SetForegroundWindow(form.Handle);
                await Task.Delay(100);
            }
            Assert(Native.GetForegroundWindow() == form.Handle, "fixture must own foreground before test; visible=" + IsWindowVisible(form.Handle) + "; SetForegroundWindow=" + activated);
            FixtureForm fixture = form as FixtureForm;
            if (fixture != null) { fixture.Editor.Focus(); fixture.Editor.SelectAll(); }
            await Task.Delay(80);
        }
        private static async Task<Dictionary<string, object>> Invoke(string arguments)
        {
            using (Process process = new Process())
            {
                process.StartInfo = new ProcessStartInfo(helper, arguments) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
                process.Start();
                string output = await process.StandardOutput.ReadToEndAsync();
                await Task.Run(delegate { process.WaitForExit(); });
                // Only the parsed status and fixed fixture text are inspected. Never log clipboard payloads.
                return json.Deserialize<Dictionary<string, object>>(output);
            }
        }
        private static string CopyArgs(Form form) { return "copy " + form.Handle.ToInt64().ToString(CultureInfo.InvariantCulture) + " " + Process.GetCurrentProcess().Id; }
        private static async Task Run(FixtureForm form)
        {
            ClipboardSnapshot original = null;
            using (HiddenOwner owner = new HiddenOwner())
            {
                try
                {
                    // Keep the user's clipboard only in native memory. Refuse the entire suite
                    // before any mutation if its formats cannot be fully preserved.
                    original = ClipboardSnapshot.Capture(owner.Handle);
                    Track();
                    await Focus(form);

                    Baseline(true);
                    using (ClipboardSnapshot snapshot = ClipboardSnapshot.Capture(owner.Handle))
                    {
                        Clipboard.SetText("temporary fixed fixture value");
                        using (new ClipboardLock(owner.Handle, 350)) snapshot.RestoreLocked();
                    }
                    Track(); CheckBaseline(true); Pass("same-process native text + HTML + bitmap snapshot/restore");

                    Baseline(); await Focus(form);
                    Dictionary<string, object> probe = await Invoke("probe");
                    Assert((bool)probe["ok"] && probe["source"] != null, "Edge source probe accepted fixture");
                    Dictionary<string, object> copied = await Invoke(CopyArgs(form));
                    Track();
                    Assert((bool)copied["ok"] && (string)copied["text"] == FixtureForm.Expected, "exact spaces/newlines copied: " + (copied.ContainsKey("error") ? (string)copied["error"] : "text mismatch") + "; copyCount=" + form.CopyCount);
                    CheckBaseline(); Pass("explicit copy preserves spaces/newlines and restores Unicode + HTML");

                    Baseline(); form.IgnoreCopy = true; int count = form.CopyCount;
                    uint before = Native.GetClipboardSequenceNumber();
                    Stopwatch elapsed = Stopwatch.StartNew();
                    Dictionary<string, object> timedOut = await Invoke(CopyArgs(form));
                    Assert(!(bool)timedOut["ok"] && form.CopyCount == count + 1 && elapsed.ElapsedMilliseconds >= 1000, "copy timeout exercised");
                    Assert(Native.GetClipboardSequenceNumber() == before, "timeout never reuses or overwrites old clipboard");
                    Track(); CheckBaseline(); form.IgnoreCopy = false; Pass("no fresh copy times out without reading old clipboard");

                    Baseline(); count = form.CopyCount;
                    using (Form other = new Form { Text = "Different foreground fixture", Width = 360, Height = 100 })
                    {
                        await Focus(other);
                        before = Native.GetClipboardSequenceNumber();
                        Dictionary<string, object> lost = await Invoke(CopyArgs(form));
                        Assert(!(bool)lost["ok"] && form.CopyCount == count && Native.GetClipboardSequenceNumber() == before, "lost foreground refuses before copy");
                    }
                    Track(); CheckBaseline(); await Focus(form); Pass("source focus changed: no copy and clipboard unchanged");

                    Baseline();
                    using (ClipboardSnapshot snapshot = ClipboardSnapshot.Capture(owner.Handle))
                    {
                        Clipboard.SetText("newer fixed clipboard text"); Track();
                        Source matchingOwner = new Source(form.Handle, (uint)Process.GetCurrentProcess().Id);
                        using (new ClipboardLock(owner.Handle, 350)) Assert(!snapshot.RestoreIfStillOwnedLocked(matchingOwner, snapshot.Sequence), "changed sequence refuses restore");
                        Assert(Clipboard.GetText() == "newer fixed clipboard text", "newer copy retained");
                        Source differentOwner = new Source(form.Handle, (uint)Process.GetCurrentProcess().Id + 1);
                        using (new ClipboardLock(owner.Handle, 350)) Assert(!snapshot.RestoreIfStillOwnedLocked(differentOwner, Native.GetClipboardSequenceNumber()), "different owner refuses restore");
                        Assert(Clipboard.GetText() == "newer fixed clipboard text", "foreign-owned data retained");
                    }
                    Track(); Pass("changed sequence or owner never overwrites newer clipboard");

                    // A valid HGLOBAL carrying an OLE-private name must still be rejected.
                    using (new ClipboardLock(owner.Handle, 350)) { Native.EmptyClipboard(); PutBytes(Native.RegisterClipboardFormat("Ole Private Data"), new byte[16]); }
                    Track(); count = form.CopyCount; before = Native.GetClipboardSequenceNumber();
                    Dictionary<string, object> ole = await Invoke(CopyArgs(form));
                    Assert(!(bool)ole["ok"] && form.CopyCount == count && Native.GetClipboardSequenceNumber() == before, "OLE process-local data refuses before copy");
                    Pass("OLE-private HGLOBAL aborts before Ctrl+C");

                    IntPtr privateHandle = Native.GlobalAlloc(2, (UIntPtr)8U);
                    try
                    {
                        using (new ClipboardLock(owner.Handle, 350)) { Native.EmptyClipboard(); Assert(Native.SetClipboardData(0x200, privateHandle) != IntPtr.Zero, "private fixture format set"); }
                        Track(); count = form.CopyCount; before = Native.GetClipboardSequenceNumber();
                        Dictionary<string, object> unsupported = await Invoke(CopyArgs(form));
                        Assert(!(bool)unsupported["ok"] && form.CopyCount == count && Native.GetClipboardSequenceNumber() == before, "unsupported format refuses before copy");
                        Pass("unsupported private format aborts before Ctrl+C");
                    }
                    finally { using (new ClipboardLock(owner.Handle, 350)) Native.EmptyClipboard(); Native.GlobalFree(privateHandle); Track(); }
                }
                catch (Exception error) { results.Add("FAIL " + (error is SafeFailure ? error.Message : error.Message)); }
                finally
                {
                    if (original != null)
                    {
                        try
                        {
                            using (new ClipboardLock(owner.Handle, 350))
                            {
                                if (Native.GetClipboardSequenceNumber() == lastOwnedSequence) original.RestoreLocked();
                                else results.Add("FAIL user clipboard changed during fixture; newer value preserved");
                            }
                        }
                        catch { results.Add("FAIL original clipboard restore failed"); }
                        original.Dispose();
                    }
                    File.WriteAllText(report, json.Serialize(new { passed = passed, results = results }), new UTF8Encoding(false));
                }
            }
        }
    }
}

// Windows-only explicit Edge selection copy. No background copying or UI automation.
// Compiled with the .NET Framework 4.x compiler shipped with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LightTranslate.SelectionCopy
{
    internal sealed class SafeFailure : Exception
    {
        internal SafeFailure(string message) : base(message) { }
    }

    internal sealed class Source
    {
        internal IntPtr Window;
        internal uint Process;
        internal Source(IntPtr window, uint process) { Window = window; Process = process; }
        internal static Source Probe()
        {
            IntPtr window = Native.GetForegroundWindow();
            uint process;
            Native.GetWindowThreadProcessId(window, out process);
            Source source = new Source(window, process);
            return source.IsCurrentEdge() ? source : null;
        }
        internal bool IsCurrentEdge()
        {
            if (Window == IntPtr.Zero || Process == 0 || !Native.IsWindow(Window) || Native.GetForegroundWindow() != Window) return false;
            uint current;
            Native.GetWindowThreadProcessId(Window, out current);
            if (current != Process) return false;
            try { using (Process process = System.Diagnostics.Process.GetProcessById((int)Process)) return string.Equals(process.ProcessName, "msedge", StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }
        internal void RequireCurrent()
        {
            if (!IsCurrentEdge()) throw new SafeFailure("原 Edge 窗口已切换或关闭，请重新选择文字。");
        }
        internal bool OwnsClipboard()
        {
            uint owner;
            IntPtr window = Native.GetClipboardOwner();
            if (window == IntPtr.Zero) return false;
            Native.GetWindowThreadProcessId(window, out owner);
            return owner == Process;
        }
    }

    internal sealed class HiddenOwner : NativeWindow, IDisposable
    {
        internal HiddenOwner() { CreateHandle(new CreateParams { Caption = "LightTranslate Clipboard Transaction", Style = unchecked((int)0x80000000) }); }
        public void Dispose() { DestroyHandle(); }
    }

    internal sealed class ClipboardLock : IDisposable
    {
        internal ClipboardLock(IntPtr owner, int timeoutMs)
        {
            Stopwatch clock = Stopwatch.StartNew();
            do
            {
                if (Native.OpenClipboard(owner)) return;
                Thread.Sleep(10);
            } while (clock.ElapsedMilliseconds < timeoutMs);
            throw new SafeFailure("剪贴板正在被其他应用使用，请稍后重试。");
        }
        public void Dispose() { Native.CloseClipboard(); }
    }

    internal sealed class ClipboardEntry : IDisposable
    {
        internal uint Format;
        internal IntPtr Handle;
        internal ClipboardEntry(uint format, IntPtr handle) { Format = format; Handle = handle; }
        public void Dispose()
        {
            if (Handle == IntPtr.Zero) return;
            if (Format == Native.CF_BITMAP) Native.DeleteObject(Handle);
            else if (Format == Native.CF_ENHMETAFILE) Native.DeleteEnhMetaFile(Handle);
            else Native.GlobalFree(Handle);
            Handle = IntPtr.Zero;
        }
    }

    internal sealed class ClipboardSnapshot : IDisposable
    {
        internal const long MaxBytes = 64L * 1024 * 1024;
        private readonly List<ClipboardEntry> entries = new List<ClipboardEntry>();
        internal uint Sequence;
        internal static ClipboardSnapshot Capture(IntPtr owner)
        {
            ClipboardSnapshot snapshot = new ClipboardSnapshot();
            try
            {
                using (new ClipboardLock(owner, 350))
                {
                    snapshot.Sequence = Native.GetClipboardSequenceNumber();
                    long total = 0;
                    uint format = 0;
                    while (true)
                    {
                        Native.SetLastError(0);
                        format = Native.EnumClipboardFormats(format);
                        if (format == 0)
                        {
                            if (Marshal.GetLastWin32Error() != 0) throw new SafeFailure("无法完整保存当前剪贴板，未执行复制。");
                            break;
                        }
                        if (Unsupported(format)) throw new SafeFailure("当前剪贴板包含不支持安全恢复的格式。请手动复制并粘贴到翻译面板。");
                        IntPtr original = Native.GetClipboardData(format);
                        if (original == IntPtr.Zero) throw new SafeFailure("无法完整保存当前剪贴板，未执行复制。");
                        IntPtr copy;
                        if (format == Native.CF_BITMAP)
                        {
                            Native.Bitmap bitmap;
                            if (Native.GetObject(original, Marshal.SizeOf(typeof(Native.Bitmap)), out bitmap) == 0) throw new SafeFailure("无法保存剪贴板图片，未执行复制。");
                            AddSize(ref total, Math.Max(Math.Abs((long)bitmap.WidthBytes) * Math.Abs((long)bitmap.Height), Math.Abs((long)bitmap.Width) * Math.Abs((long)bitmap.Height) * 4));
                            copy = Native.CopyImage(original, 0, 0, 0, 0x2000); // A new DIB-section handle, never LR_COPYRETURNORG.
                        }
                        else if (format == Native.CF_ENHMETAFILE)
                        {
                            uint size = Native.GetEnhMetaFileBits(original, 0, IntPtr.Zero);
                            AddSize(ref total, size);
                            copy = Native.CopyEnhMetaFile(original, null);
                        }
                        else
                        {
                            ulong length = Native.GlobalSize(original).ToUInt64();
                            if (length == 0 || length > (ulong)MaxBytes) throw new SafeFailure("剪贴板包含无法安全复制或过大的数据，未执行复制。");
                            AddSize(ref total, (long)length);
                            copy = CopyGlobal(original, (int)length);
                        }
                        if (copy == IntPtr.Zero) throw new SafeFailure("无法完整保存当前剪贴板，未执行复制。");
                        snapshot.entries.Add(new ClipboardEntry(format, copy));
                    }
                    if (Native.GetClipboardSequenceNumber() != snapshot.Sequence) throw new SafeFailure("剪贴板在保存期间发生变化，未执行复制。");
                }
                return snapshot;
            }
            catch { snapshot.Dispose(); throw; }
        }
        private static bool Unsupported(uint format)
        {
            if (format >= 0xC000)
            {
                StringBuilder name = new StringBuilder(256);
                if (Native.GetClipboardFormatName(format, name, name.Capacity) == 0) return true;
                string value = name.ToString();
                // These formats contain COM/process-local references or OLE object graphs,
                // not transferable opaque bytes even when GlobalSize succeeds.
                string[] unsupportedNames = { "DataObject", "Ole Private Data", "ObjectLink", "OwnerLink", "Embed Source", "Embedded Object", "Link Source", "Link Source Descriptor", "Object Descriptor", "FileContents", "PersistentObject" };
                foreach (string known in unsupportedNames) if (string.Equals(value, known, StringComparison.OrdinalIgnoreCase)) return true;
                if (value.StartsWith("System.", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return format == 3 || format == 9 || format == 0x80 || // METAFILEPICT, PALETTE, OWNERDISPLAY
                format >= 0x81 && format <= 0x8E || // owner-display variants
                format >= 0x200 && format <= 0x3FF; // private handles and GDI object ranges
        }
        private static void AddSize(ref long total, long bytes)
        {
            if (bytes <= 0 || bytes > MaxBytes || total > MaxBytes - bytes) throw new SafeFailure("当前剪贴板数据超过 64 MiB，未执行复制。请手动粘贴文字。");
            total += bytes;
        }
        private static IntPtr CopyGlobal(IntPtr original, int size)
        {
            IntPtr source = Native.GlobalLock(original);
            if (source == IntPtr.Zero) throw new SafeFailure("无法读取剪贴板格式，未执行复制。");
            IntPtr copy = IntPtr.Zero;
            try
            {
                copy = Native.GlobalAlloc(2, (UIntPtr)(uint)size);
                if (copy == IntPtr.Zero) throw new SafeFailure("无法分配剪贴板备份空间，未执行复制。");
                IntPtr destination = Native.GlobalLock(copy);
                if (destination == IntPtr.Zero) throw new SafeFailure("无法保存剪贴板格式，未执行复制。");
                try { Native.CopyMemory(destination, source, (UIntPtr)(uint)size); }
                finally { Native.GlobalUnlock(copy); }
                return copy;
            }
            catch { if (copy != IntPtr.Zero) Native.GlobalFree(copy); throw; }
            finally { Native.GlobalUnlock(original); }
        }
        // Caller owns the clipboard lock and has checked sequence + owner under that lock.
        // Every handle was allocated before EmptyClipboard. Ownership transfers only on success.
        internal void RestoreLocked()
        {
            if (!Native.EmptyClipboard()) throw new SafeFailure("未能恢复原剪贴板，请检查剪贴板内容后重试。");
            bool incomplete = false;
            foreach (ClipboardEntry entry in entries)
            {
                if (Native.SetClipboardData(entry.Format, entry.Handle) == IntPtr.Zero) incomplete = true;
                else entry.Handle = IntPtr.Zero;
            }
            if (incomplete) throw new SafeFailure("原剪贴板未能完整恢复，已停止翻译。请检查剪贴板内容。");
        }
        internal bool RestoreIfStillOwnedLocked(Source source, uint sequence)
        {
            if (Native.GetClipboardSequenceNumber() != sequence || !source.OwnsClipboard()) return false;
            RestoreLocked();
            return true;
        }
        public void Dispose() { foreach (ClipboardEntry entry in entries) entry.Dispose(); entries.Clear(); }
    }

    internal static class Capture
    {
        internal static string Run(Source source)
        {
            source.RequireCurrent();
            using (HiddenOwner owner = new HiddenOwner())
            using (ClipboardSnapshot original = ClipboardSnapshot.Capture(owner.Handle))
            {
                uint copiedSequence = original.Sequence;
                bool observedCopy = false, restoreAttempted = false, copyMayHaveOccurred = false;
                try
                {
                    Stopwatch release = Stopwatch.StartNew();
                    while (ModifiersDown())
                    {
                        source.RequireCurrent();
                        if (release.ElapsedMilliseconds >= 600) throw new SafeFailure("请松开 Ctrl、Alt、Shift 和 Windows 键后重试。未执行复制。");
                        Thread.Sleep(15);
                    }
                    source.RequireCurrent();
                    if (Native.GetClipboardSequenceNumber() != original.Sequence) throw new SafeFailure("剪贴板已经变化，未执行复制。");
                    SendCopy(ref copyMayHaveOccurred);
                    Stopwatch deadline = Stopwatch.StartNew();
                    while (deadline.ElapsedMilliseconds < 1200)
                    {
                        uint current = Native.GetClipboardSequenceNumber();
                        if (current != original.Sequence) { copiedSequence = current; observedCopy = true; break; }
                        source.RequireCurrent();
                        Thread.Sleep(15);
                    }
                    if (!observedCopy) throw new SafeFailure("Edge 未提供新的复制文本，请重新选择，或手动复制后粘贴到翻译面板。");
                    using (new ClipboardLock(owner.Handle, 350))
                    {
                        if (Native.GetClipboardSequenceNumber() != copiedSequence || !source.OwnsClipboard()) throw new SafeFailure("剪贴板已被其他操作修改，未读取或覆盖其内容。");
                        try
                        {
                            source.RequireCurrent();
                            return ReadTextLocked();
                        }
                        finally { restoreAttempted = true; original.RestoreLocked(); }
                    }
                }
                finally
                {
                    // A partial SendInput can still have sent C-down before reporting failure.
                    // Only claim a fresh value attributable to the original Edge process.
                    if (copyMayHaveOccurred && !observedCopy)
                    {
                        uint current = Native.GetClipboardSequenceNumber();
                        if (current != original.Sequence && source.OwnsClipboard()) { copiedSequence = current; observedCopy = true; }
                    }
                    // Never overwrite a later user copy. The check and replacement are one locked operation.
                    if (observedCopy && !restoreAttempted)
                    {
                        using (new ClipboardLock(owner.Handle, 350))
                        {
                            original.RestoreIfStillOwnedLocked(source, copiedSequence);
                        }
                    }
                }
            }
        }
        private static bool ModifiersDown()
        {
            int[] keys = { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0x43 };
            foreach (int key in keys) if ((Native.GetAsyncKeyState(key) & 0x8000) != 0) return true;
            return false;
        }
        private static void SendCopy(ref bool copyMayHaveOccurred)
        {
            Native.Input[] inputs = { Native.Key(0x11, false), Native.Key(0x43, false), Native.Key(0x43, true), Native.Key(0x11, true) };
            uint sent = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.Input)));
            copyMayHaveOccurred = sent >= 2;
            if (sent != inputs.Length)
            {
                if (sent > 0) { Native.Input[] release = { Native.Key(0x43, true), Native.Key(0x11, true) }; Native.SendInput((uint)release.Length, release, Marshal.SizeOf(typeof(Native.Input))); }
                throw new SafeFailure("无法向 Edge 发送复制操作，请手动复制后粘贴。");
            }
        }
        private static string ReadTextLocked()
        {
            IntPtr handle = Native.GetClipboardData(Native.CF_UNICODETEXT);
            if (handle == IntPtr.Zero) throw new SafeFailure("当前选区没有可复制的文字，请重新选择。");
            ulong bytes = Native.GlobalSize(handle).ToUInt64();
            if (bytes < 2 || bytes > 24002) throw new SafeFailure("复制文本为空或超过 12000 字符，请缩小选区。");
            IntPtr data = Native.GlobalLock(handle);
            if (data == IntPtr.Zero) throw new SafeFailure("无法读取复制文本，请重试。");
            try
            {
                string raw = Marshal.PtrToStringUni(data, (int)bytes / 2);
                int terminator = raw.IndexOf('\0');
                if (terminator < 0) throw new SafeFailure("Edge 返回了无效的复制文本。");
                string text = raw.Substring(0, terminator);
                if (string.IsNullOrWhiteSpace(text) || text.Length > 12000) throw new SafeFailure("复制文本为空或超过 12000 字符，请缩小选区。");
                return text; // Preserve spaces/newlines exactly; never infer missing PDF words.
            }
            finally { Native.GlobalUnlock(handle); }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            JavaScriptSerializer json = new JavaScriptSerializer();
            try
            {
                if (args.Length == 1 && args[0] == "probe")
                {
                    Source source = Source.Probe();
                    Console.Write(json.Serialize(new { ok = true, source = source == null ? null : new { hwnd = source.Window.ToInt64().ToString(CultureInfo.InvariantCulture), pid = source.Process } }));
                    return 0;
                }
                long hwnd; uint pid;
                if (args.Length != 3 || args[0] != "copy" || !long.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out hwnd) || hwnd <= 0 || !uint.TryParse(args[2], NumberStyles.None, CultureInfo.InvariantCulture, out pid) || pid == 0) throw new SafeFailure("复制请求无效，请重新选择文字。");
                string text = Capture.Run(new Source(new IntPtr(hwnd), pid));
                Console.Write(json.Serialize(new { ok = true, text = text }));
                return 0;
            }
            catch (SafeFailure error) { Console.Write(json.Serialize(new { ok = false, error = error.Message })); return 1; }
            catch { Console.Write(json.Serialize(new { ok = false, error = "无法安全复制当前选区，请手动复制后粘贴到翻译面板。" })); return 1; }
        }
    }

    internal static class Native
    {
        internal const uint CF_BITMAP = 2, CF_UNICODETEXT = 13, CF_ENHMETAFILE = 14;
        [StructLayout(LayoutKind.Sequential)] internal struct Bitmap { internal int Type, Width, Height, WidthBytes; internal ushort Planes, BitsPixel; internal IntPtr Bits; }
        [StructLayout(LayoutKind.Sequential)] internal struct Input { internal uint Type; internal InputUnion Data; }
        [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] internal KeyboardInput Keyboard; [FieldOffset(0)] internal MouseInput Mouse; }
        [StructLayout(LayoutKind.Sequential)] internal struct KeyboardInput { internal ushort VirtualKey, ScanCode; internal uint Flags, Time; internal IntPtr ExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] internal struct MouseInput { internal int X, Y; internal uint Data, Flags, Time; internal IntPtr ExtraInfo; }
        internal static Input Key(ushort key, bool up) { return new Input { Type = 1, Data = new InputUnion { Keyboard = new KeyboardInput { VirtualKey = key, Flags = up ? 2U : 0U } } }; }
        [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
        [DllImport("user32.dll", SetLastError = true)] internal static extern bool OpenClipboard(IntPtr owner);
        [DllImport("user32.dll")] internal static extern bool CloseClipboard();
        [DllImport("user32.dll")] internal static extern bool EmptyClipboard();
        [DllImport("user32.dll")] internal static extern uint GetClipboardSequenceNumber();
        [DllImport("user32.dll")] internal static extern IntPtr GetClipboardOwner();
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint EnumClipboardFormats(uint format);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClipboardFormatName(uint format, StringBuilder name, int length);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern uint RegisterClipboardFormat(string name);
        [DllImport("user32.dll")] internal static extern IntPtr GetClipboardData(uint format);
        [DllImport("user32.dll")] internal static extern IntPtr SetClipboardData(uint format, IntPtr data);
        [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", SetLastError = true)] internal static extern uint SendInput(uint count, Input[] inputs, int size);
        [DllImport("kernel32.dll")] internal static extern UIntPtr GlobalSize(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalLock(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern bool GlobalUnlock(IntPtr handle);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
        [DllImport("kernel32.dll")] internal static extern IntPtr GlobalFree(IntPtr handle);
        [DllImport("kernel32.dll", EntryPoint = "RtlMoveMemory")] internal static extern void CopyMemory(IntPtr destination, IntPtr source, UIntPtr length);
        [DllImport("kernel32.dll")] internal static extern void SetLastError(uint error);
        [DllImport("user32.dll")] internal static extern IntPtr CopyImage(IntPtr image, uint type, int width, int height, uint flags);
        [DllImport("gdi32.dll")] internal static extern int GetObject(IntPtr image, int size, out Bitmap bitmap);
        [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr image);
        [DllImport("gdi32.dll")] internal static extern uint GetEnhMetaFileBits(IntPtr image, uint size, IntPtr data);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr CopyEnhMetaFile(IntPtr image, string file);
        [DllImport("gdi32.dll")] internal static extern bool DeleteEnhMetaFile(IntPtr image);
    }
}

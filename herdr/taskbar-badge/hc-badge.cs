// hc-badge: set or clear a dot overlay on the herdr-app taskbar button.
// Usage: hc-badge blocked <n> | hc-badge done <n> | hc-badge off
// Exit: 0 ok, 1 bad arguments, 2 no herdr-app window, 3 taskbar call failed.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// Vtable order must match shobjidl.h: ITaskbarList, ITaskbarList2, then ITaskbarList3.
[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ITaskbarList3
{
    void HrInit();
    void AddTab(IntPtr hwnd);
    void DeleteTab(IntPtr hwnd);
    void ActivateTab(IntPtr hwnd);
    void SetActiveAlt(IntPtr hwnd);
    void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
    void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
    void SetProgressState(IntPtr hwnd, int flags);
    void RegisterTab(IntPtr hwndTab, IntPtr hwndMdi);
    void UnregisterTab(IntPtr hwndTab);
    void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
    void SetTabActive(IntPtr hwndTab, IntPtr hwndMdi, uint reserved);
    void ThumbBarAddButtons(IntPtr hwnd, uint count, IntPtr buttons);
    void ThumbBarUpdateButtons(IntPtr hwnd, uint count, IntPtr buttons);
    void ThumbBarSetImageList(IntPtr hwnd, IntPtr imageList);
    void SetOverlayIcon(IntPtr hwnd, IntPtr icon, [MarshalAs(UnmanagedType.LPWStr)] string description);
}

[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
class TaskbarList { }

static class HcBadge
{
    const string Usage = "usage: hc-badge blocked <n> | hc-badge done <n> | hc-badge off";

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool DestroyIcon(IntPtr icon);

    [STAThread]
    static int Main(string[] args)
    {
        string state = args.Length > 0 ? args[0] : "";
        int count = 0;
        bool valid =
            (state == "off" && args.Length == 1) ||
            ((state == "blocked" || state == "done") && args.Length == 2 &&
             int.TryParse(args[1], out count) && count >= 1);
        if (!valid)
        {
            Console.Error.WriteLine(Usage);
            return 1;
        }

        // HC_BADGE_PROCESS overrides the target process name (used for tests).
        string processName = Environment.GetEnvironmentVariable("HC_BADGE_PROCESS");
        if (string.IsNullOrEmpty(processName)) processName = "herdr-app";
        IntPtr hwnd = FindMainWindow(processName);
        if (hwnd == IntPtr.Zero)
        {
            Console.Error.WriteLine("hc-badge: no visible window for process " + processName);
            return 2;
        }

        try
        {
            var taskbar = (ITaskbarList3)new TaskbarList();
            taskbar.HrInit();
            if (state == "off")
            {
                taskbar.SetOverlayIcon(hwnd, IntPtr.Zero, null);
                return 0;
            }
            Color color = state == "blocked"
                ? Color.FromArgb(0xF5, 0x9E, 0x0B)
                : Color.FromArgb(0x22, 0xC5, 0x5E);
            string noun = count == 1 ? "agent" : "agents";
            string text = state == "blocked"
                ? count + " " + noun + (count == 1 ? " needs you" : " need you")
                : count + " " + noun + " ready";
            IntPtr icon = CreateDotIcon(color);
            try
            {
                taskbar.SetOverlayIcon(hwnd, icon, text);
            }
            finally
            {
                DestroyIcon(icon);
            }
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("hc-badge: taskbar call failed: " + e.Message);
            return 3;
        }
    }

    static IntPtr FindMainWindow(string processName)
    {
        foreach (Process p in Process.GetProcessesByName(processName))
        {
            try
            {
                IntPtr hwnd = p.MainWindowHandle;
                if (hwnd != IntPtr.Zero && IsWindowVisible(hwnd)) return hwnd;
            }
            catch (Exception) { } // the process ended during the loop: skip it
        }
        return IntPtr.Zero;
    }

    static IntPtr CreateDotIcon(Color color)
    {
        using (var bmp = new Bitmap(16, 16, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(bmp))
            using (var brush = new SolidBrush(color))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                g.FillEllipse(brush, 1, 1, 14, 14);
            }
            return bmp.GetHicon();
        }
    }
}

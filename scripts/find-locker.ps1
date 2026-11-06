Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class FileUtil {
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Auto)]
    static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

    [DllImport("rstrtmgr.dll")]
    static extern int RmEndSession(uint pSessionHandle);

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Auto)]
    static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames,
        uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

    [DllImport("rstrtmgr.dll")]
    static extern int RmGetList(uint pSessionHandle, out uint pnProcInfoNeeded,
        ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);

    [StructLayout(LayoutKind.Sequential)]
    struct RM_UNIQUE_PROCESS {
        public int dwProcessId;
        public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    struct RM_PROCESS_INFO {
        public RM_UNIQUE_PROCESS Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string strAppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string strServiceShortName;
        public int ApplicationType;
        public uint AppStatus;
        public uint TSSessionId;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bRestartable;
    }

    public static List<int> WhoIsLocking(string path) {
        uint handle;
        string key = Guid.NewGuid().ToString();
        int res = RmStartSession(out handle, 0, key);
        if (res != 0) return new List<int>();

        try {
            string[] resources = new string[] { path };
            res = RmRegisterResources(handle, (uint)resources.Length, resources, 0, null, 0, null);
            if (res != 0) return new List<int>();

            uint procInfoNeeded = 0;
            uint procInfo = 0;
            uint rebootReasons = 0;
            res = RmGetList(handle, out procInfoNeeded, ref procInfo, null, ref rebootReasons);
            if (res == 234) { // ERROR_MORE_DATA
                RM_PROCESS_INFO[] processInfo = new RM_PROCESS_INFO[procInfoNeeded];
                procInfo = procInfoNeeded;
                res = RmGetList(handle, out procInfoNeeded, ref procInfo, processInfo, ref rebootReasons);
                if (res == 0) {
                    List<int> processes = new List<int>();
                    for (int i = 0; i < procInfo; i++) {
                        processes.Add(processInfo[i].Process.dwProcessId);
                    }
                    return processes;
                }
            }
        } finally {
            RmEndSession(handle);
        }
        return new List<int>();
    }
}
"@

$pids = [FileUtil]::WhoIsLocking("D:\IT\Saas\node_modules\.prisma\client\query_engine-windows.dll.node")
foreach ($p in $pids) {
    Get-Process -Id $p | Select-Object Id, ProcessName, Path
}


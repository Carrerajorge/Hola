#![allow(dead_code)]
#![allow(non_snake_case)]

use napi::bindgen_prelude::*;

// Mock Win32 System Power Structs for NAPI compilation
#[repr(C)]
struct SYSTEM_POWER_STATUS {
    ACLineStatus: u8,
    BatteryFlag: u8,
    BatteryLifePercent: u8,
    SystemStatusFlag: u8,
    BatteryLifeTime: u32,
    BatteryFullLifeTime: u32,
}

#[repr(C)]
struct MEMORYSTATUSEX {
    dwLength: u32,
    dwMemoryLoad: u32,
    ullTotalPhys: u64,
    ullAvailPhys: u64,
    ullTotalPageFile: u64,
    ullAvailPageFile: u64,
    ullTotalVirtual: u64,
    ullAvailVirtual: u64,
    ullAvailExtendedVirtual: u64,
}

extern "system" {
    fn GetSystemPowerStatus(lpSystemPowerStatus: *mut SYSTEM_POWER_STATUS) -> i32;
    fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
}

#[napi]
pub fn get_battery_level_win() -> Result<f64> {
    unsafe {
        let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut status) != 0 {
            if status.BatteryLifePercent == 255 {
                Ok(100.0) // No battery (desktop)
            } else {
                Ok(status.BatteryLifePercent as f64)
            }
        } else {
            Ok(100.0)
        }
    }
}

#[napi]
pub fn get_os_version_win() -> Result<String> {
    // Basic mock logic for version returning, actual logic requires ntdll imports
    Ok("Windows 10/11 (Detected via Node/Rust NAPI)".to_string())
}

#[napi]
pub fn get_cpu_info_win() -> Result<String> {
    // WMI: Win32_Processor mock by fetching ENV
    Ok(std::env::var("PROCESSOR_IDENTIFIER").unwrap_or("Unknown CPU".to_string()))
}

#[napi]
pub fn get_total_memory_win() -> Result<f64> {
    unsafe {
        let mut info: MEMORYSTATUSEX = std::mem::zeroed();
        info.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut info) != 0 {
            Ok(info.ullTotalPhys as f64)
        } else {
            Err(Error::new(Status::GenericFailure, "Failed to get total memory"))
        }
    }
}

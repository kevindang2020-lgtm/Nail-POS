@echo off
rem launch-customer-display.cmd — double-click (or put a shortcut to it in the Startup folder: Windows+R, shell:startup)
rem to open the AI PowerSalon customer display full-screen on the customer monitor. Set APS_CUSTOMER_DISPLAY_URL first,
rem or pass the address: launch-customer-display.cmd https://pos.example.com/customer-display/
rem See docs/CUSTOMER_DISPLAY_WINDOWS_SETUP.md.
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-customer-display.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-customer-display.ps1" -Url "%~1"
)

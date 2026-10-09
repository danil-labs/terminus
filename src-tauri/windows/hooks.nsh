; The engine runs beside terminus.exe as its own process. Installing over it or
; uninstalling would leave it alive and its executable locked.
; NSIS is 32-bit: its PowerShell cannot read Process.Path of the 64-bit engine, WMI can.
!macro TERMINUS_STOP_ENGINE
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'seldon-runtime.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

; The engine runs beside terminus.exe as its own process. Installing over it or
; uninstalling would leave it alive and its executable locked.
!macro TERMINUS_STOP_ENGINE
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-Process seldon-runtime -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

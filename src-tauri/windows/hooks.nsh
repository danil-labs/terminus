; The engine runs beside terminus.exe as its own process. Installing over it or
; uninstalling asks it to stop; with work in flight the installer stops instead.
; Windows close first so none of them starts the engine again meanwhile.
; __FILEDIR__ inside a macro names the file that expands it, so it is read here.
!define TERMINUS_HOOKS_DIR "${__FILEDIR__}"

!macro TERMINUS_STOP_ENGINE
  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  InitPluginsDir
  File "/oname=$PLUGINSDIR\stop-engine.ps1" "${TERMINUS_HOOKS_DIR}\stop-engine.ps1"
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-engine.ps1" -InstallDir "$INSTDIR"`
  Pop $0
  ${If} $0 == 2
    MessageBox MB_ICONEXCLAMATION|MB_OK "Terminus is still working: a task or a download is running. It keeps going with the window closed. Open Terminus, wait for it to finish or stop it, and run this again." /SD IDOK
    Abort
  ${ElseIf} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "The Terminus engine (seldon-runtime.exe) did not answer. Close it from Task Manager and run this again." /SD IDOK
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TERMINUS_STOP_ENGINE
!macroend

; The engine runs beside terminus.exe and outlives the window. Before replacing or
; removing it, the installer asks it for `service stop`, which it refuses with live
; turns; then the installer stops instead of cutting them. Only a silent engine is killed.
; NSIS is 32-bit: its PowerShell cannot read Process.Path of the 64-bit engine, WMI can.
!macro TERMINUS_KILL_ENGINE
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq 'seldon-runtime.exe' -and $$_.ExecutablePath -like '$INSTDIR\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
!macroend

; `terminus.exe --stop-engine` exits 0 when it stopped, 3 when the engine is working, 1 when it did not answer.
!macro TERMINUS_STOP_ENGINE STOPPER
  nsExec::Exec `"${STOPPER}" --stop-engine`
  Pop $0
  ${If} $0 == 3
    MessageBox MB_OK|MB_ICONEXCLAMATION "Terminus is still working on a task. Let it finish, or stop it, and run this again.$\r$\n$\r$\nTerminus sigue trabajando en una tarea. Deja que termine, o detenla, y vuelve a ejecutar esto." /SD IDOK
    Abort
  ${ElseIf} $0 != 0
    !insertmacro TERMINUS_KILL_ENGINE
  ${EndIf}
!macroend

; The new terminus.exe asks, not the installed one: 0.2.74 does not know `--stop-engine`.
!macro NSIS_HOOK_PREINSTALL
  InitPluginsDir
  File "/oname=$PLUGINSDIR\terminus-stop-engine.exe" "${MAINBINARYSRCPATH}"
  !insertmacro TERMINUS_STOP_ENGINE "$PLUGINSDIR\terminus-stop-engine.exe"
  Delete "$PLUGINSDIR\terminus-stop-engine.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro TERMINUS_STOP_ENGINE "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

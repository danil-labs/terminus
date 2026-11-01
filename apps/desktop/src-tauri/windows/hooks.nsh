; The engine runs beside terminus.exe and outlives the window. Before removing it,
; the uninstaller asks it for `service stop`, which it refuses with live turns;
; then the uninstaller stops instead of cutting them. Only a silent engine is killed.
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
    MessageBox MB_OK|MB_ICONEXCLAMATION "Danil is still working on a task. Let it finish, or stop it, and run this again.$\r$\n$\r$\nDanil sigue trabajando en una tarea. Deja que termine, o detenla, y vuelve a ejecutar esto." /SD IDOK
    Abort
  ${ElseIf} $0 != 0
    !insertmacro TERMINUS_KILL_ENGINE
  ${EndIf}
!macroend

!macro TERMINUS_SWEEP
  Delete "$INSTDIR\old_*seldon-runtime.exe"
  ${IfNot} ${FileExists} "$INSTDIR\old_*seldon-runtime.exe"
    Delete "$INSTDIR\old_*.exe"
  ${EndIf}
!macroend

; Windows renames a running .exe but does not overwrite it: what is open keeps
; running from old_*, and Terminus removes those files when it starts again.
; Window and engine share one prefix: a set-aside engine still working is reopened
; with its own window, so that window stays while any set-aside engine is left.
!macro TERMINUS_SET_ASIDE WINDOW
  !insertmacro TERMINUS_SWEEP
  StrCpy $R8 "$INSTDIR\old_"
  ${If} ${FileExists} "$INSTDIR\old_${WINDOW}"
  ${OrIf} ${FileExists} "$INSTDIR\old_seldon-runtime.exe"
    System::Call 'kernel32::GetTickCount()i.R9'
    StrCpy $R8 "$INSTDIR\old_$R9_"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\${WINDOW}"
    Rename "$INSTDIR\${WINDOW}" "$R8${WINDOW}"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\seldon-runtime.exe"
    Rename "$INSTDIR\seldon-runtime.exe" "$R8seldon-runtime.exe"
  ${EndIf}
!macroend

; The template kills Terminus before installing. Installing sets the files aside
; instead; only a real uninstall closes Terminus. An installer replacing this copy
; runs the uninstaller in place (`_?=$INSTDIR`); Settings runs a temporary copy.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !ifdef __UNINSTALL__
    ${If} $EXEDIR == $INSTDIR
      !insertmacro TERMINUS_SET_ASIDE "${executableName}"
    ${Else}
      nsis_tauri_utils::FindProcessCurrentUser "${executableName}"
      Pop $R0
      ${If} $R0 = 0
        nsis_tauri_utils::StrReplace "$(appRunningOkKill)" "{{product_name}}" "${productName}"
        Pop $R2
        MessageBox MB_OKCANCEL $R2 /SD IDOK IDOK +2
        Abort
        nsis_tauri_utils::KillProcessCurrentUser "${executableName}"
        Pop $R0
        Sleep 500
      ${EndIf}
      ; The window restarts the engine that PREUNINSTALL stopped; that one has no turns yet.
      !insertmacro TERMINUS_KILL_ENGINE
    ${EndIf}
  !endif
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro TERMINUS_SET_ASIDE "${MAINBINARYNAME}.exe"
!macroend

; The app shows its own notice; silent and passive runs come from it.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro TERMINUS_SWEEP
  ${If} ${FileExists} "$INSTDIR\old_*.exe"
  ${AndIfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    MessageBox MB_OK|MB_ICONINFORMATION "Terminus ${VERSION} is installed. Restart Terminus to use it. If tasks are working, Terminus will offer to restart when they finish.$\r$\n$\r$\nTerminus ${VERSION} quedó instalado. Reinicia Terminus para usarlo. Si hay tareas trabajando, Terminus te avisará para reiniciar cuando terminen."
    ; The finish page would run a second window next to the open one; its shortcut box is checked by default.
    Call CreateOrUpdateDesktopShortcut
    ; Without it, Quit exits with 2, as if the script had aborted.
    SetErrorLevel 0
    Quit
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $EXEDIR != $INSTDIR
    !insertmacro TERMINUS_STOP_ENGINE "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
!macroend

; The engine keeps older tool trees while turns use them, so the template's per-file
; delete leaves them behind. Only a real uninstall (a temporary copy) removes them all.
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro TERMINUS_SWEEP
  ${If} $EXEDIR != $INSTDIR
    RMDir /r "$INSTDIR\work-tools"
  ${EndIf}
!macroend

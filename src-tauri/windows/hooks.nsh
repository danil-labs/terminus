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
    MessageBox MB_OK|MB_ICONEXCLAMATION "Terminus is still working on a task. Let it finish, or stop it, and run this again.$\r$\n$\r$\nTerminus sigue trabajando en una tarea. Deja que termine, o detenla, y vuelve a ejecutar esto." /SD IDOK
    Abort
  ${ElseIf} $0 != 0
    !insertmacro TERMINUS_KILL_ENGINE
  ${EndIf}
!macroend

; Windows renames a running .exe but does not overwrite it: what is open keeps
; running from old_*, and Terminus removes those files when it starts again.
!macro TERMINUS_SET_ASIDE NAME
  ${If} ${FileExists} "$INSTDIR\${NAME}"
    Delete "$INSTDIR\old_${NAME}"
    ClearErrors
    Rename "$INSTDIR\${NAME}" "$INSTDIR\old_${NAME}"
    ${If} ${Errors}
      System::Call 'kernel32::GetTickCount()i.R9'
      Rename "$INSTDIR\${NAME}" "$INSTDIR\old_$R9_${NAME}"
    ${EndIf}
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
      !insertmacro TERMINUS_SET_ASIDE "seldon-runtime.exe"
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
  !insertmacro TERMINUS_SET_ASIDE "seldon-runtime.exe"
!macroend

; The app shows its own notice; silent and passive runs come from it.
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\old_*.exe"
  ${If} ${FileExists} "$INSTDIR\old_*.exe"
  ${AndIfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
    MessageBox MB_OK|MB_ICONINFORMATION "Terminus ${VERSION} is installed. Restart Terminus to use it; tasks that are running keep working.$\r$\n$\r$\nTerminus ${VERSION} quedó instalado. Reinicia Terminus para usarlo; las tareas que están corriendo siguen trabajando."
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

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\old_*.exe"
!macroend

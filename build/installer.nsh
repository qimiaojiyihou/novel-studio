!include "getProcessInfo.nsh"

Var pid

!ifndef BUILD_UNINSTALLER
  # electron-builder normally extracts the new uninstaller only after it has
  # invoked the installed old one. Bootstrap the fixed uninstaller first so a
  # machine that already has the affected release can enter the normal upgrade
  # path instead of executing the broken legacy process check again.
  !macro novelStudioRepairLegacyUninstaller
    IfFileExists "$INSTDIR\${UNINSTALL_FILENAME}" 0 novelStudioNoLegacyUninstaller
      InitPluginsDir
      File /oname=$PLUGINSDIR\novel-studio-fixed-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
      ClearErrors
      CopyFiles /SILENT "$PLUGINSDIR\novel-studio-fixed-uninstaller.exe" "$INSTDIR\${UNINSTALL_FILENAME}"
      IfErrors 0 novelStudioLegacyUninstallerRepaired
        DetailPrint "Unable to replace the legacy Novel Studio uninstaller."
        SetErrorLevel 2
        Quit
      novelStudioLegacyUninstallerRepaired:
        DetailPrint "Repaired the legacy Novel Studio uninstaller before upgrade."
    novelStudioNoLegacyUninstaller:
  !macroend
!endif

# electron-builder 26.8.1 checks every process below $INSTDIR. During an
# upgrade the old uninstaller itself runs from that directory, so the stock
# check can mistake the uninstaller for Novel Studio and can never close it.
# Keep the broad file-lock protection, but always exclude the current NSIS
# process from both discovery and termination.
!macro novelStudioFindInstalledProcess _RETURN
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "if ((Get-CimInstance -ClassName Win32_Process | ? {$$_.ProcessId -ne $pid -and $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')}).Count -gt 0) { exit 0 } else { exit 1 }"`
    Pop ${_RETURN}
  ${else}
    # The fallback deliberately checks the real application executable only;
    # setup/uninstaller executables have different names and are not matches.
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop ${_RETURN}
  ${endIf}
!macroend

!macro novelStudioStopInstalledProcess _FORCE
  ${if} $IsPowerShellAvailable == 0
    ${if} ${_FORCE} == 1
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.ProcessId -ne $pid -and $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    ${else}
      nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.ProcessId -ne $pid -and $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -ErrorAction SilentlyContinue }"`
    ${endIf}
    Pop $0
  ${else}
    ${if} ${_FORCE} == 1
      nsProcess::_KillProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    ${else}
      nsProcess::_CloseProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    ${endIf}
    Pop $0
  ${endIf}
!macroend

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  !insertmacro IS_POWERSHELL_AVAILABLE

  # The generated uninstaller is never the app executable, but the guard also
  # protects custom packaging where both names might be made identical.
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 300
    ${endIf}

    !insertmacro novelStudioFindInstalledProcess $R0
    ${if} $R0 == 0
      ${if} ${isUpdated}
        Sleep 1000
        Goto novelStudioStopProcess
      ${endIf}

      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK novelStudioStopProcess
      Quit

      novelStudioStopProcess:
        DetailPrint "$(appClosing)"
        !insertmacro novelStudioStopInstalledProcess 0
        Sleep 500

        StrCpy $R1 0
        novelStudioWaitForExit:
          IntOp $R1 $R1 + 1
          !insertmacro novelStudioFindInstalledProcess $R0
          ${if} $R0 == 0
            Sleep 1000
            !insertmacro novelStudioStopInstalledProcess 1
            Sleep 300
            !insertmacro novelStudioFindInstalledProcess $R0
            ${if} $R0 == 0
              ${if} $R1 > 1
                MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY novelStudioWaitForExit
                Quit
              ${else}
                Sleep 1500
                Goto novelStudioWaitForExit
              ${endIf}
            ${endIf}
          ${endIf}
    ${endIf}
  ${endIf}

  !ifndef BUILD_UNINSTALLER
    !insertmacro novelStudioRepairLegacyUninstaller
  !endif
!macroend

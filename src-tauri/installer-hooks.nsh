!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "pillow-control"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "pillow-control"
  ${EndIf}
!macroend

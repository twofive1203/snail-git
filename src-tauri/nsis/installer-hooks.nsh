; SnailGit Tauri NSIS installer hooks.
;
; NOTE: this file used to define NSIS_HOOK_PREINSTALL as:
;     StrCpy $INSTDIR "$LOCALAPPDATA\Programs\SnailGit"
;     SetOutPath $INSTDIR
; That hard-coded the install directory and silently overrode whatever the
; user picked on the "Choose Install Location" page (the chosen path was
; always discarded, so every install landed in the same folder).
; It was removed on purpose: with installMode=currentUser Tauri already
; defaults to %LOCALAPPDATA%\SnailGit, so no hook is required.
;
; To customize the installer again, define any of these macros here:
;   NSIS_HOOK_PREINSTALL
;   NSIS_HOOK_POSTINSTALL
;   NSIS_HOOK_PREUNINSTALL
;   NSIS_HOOK_POSTUNINSTALL

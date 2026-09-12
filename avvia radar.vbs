Option Explicit
Dim shell, fs, folder, code, quote, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
quote = Chr(34)
command = "cmd.exe /d /c " & quote & quote & folder & "\avvia radar locale.bat" & quote & " --background" & quote
code = shell.Run(command, 0, True)
If code <> 0 Then
  MsgBox "Il Radar non si e avviato. Controlla Python e il file radar-avvio.log nella cartella del progetto.", vbExclamation, "LootSniper"
End If

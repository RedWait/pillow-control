param([ValidateSet('backup','read','restore','clear')][string]$Mode,[string]$BackupPath)
$ErrorActionPreference='Stop'
$paths=@('Software\Microsoft\Windows\CurrentVersion\Run','Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run')
$name='pillow-control'
if($Mode -eq 'backup') {
 $values=@(foreach($path in $paths){$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path);$value=if($key){$key.GetValue($name)}else{$null};$kind=if($null -ne $value){$key.GetValueKind($name).ToString()}else{'String'};@{path=$path;value=$value;kind=$kind};if($key){$key.Dispose()}})
 ConvertTo-Json -InputObject $values -Depth 4 | Set-Content -Encoding utf8 -LiteralPath $BackupPath
}
if($Mode -eq 'restore') {
 foreach($entry in (Get-Content -Raw -LiteralPath $BackupPath | ConvertFrom-Json)){$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($entry.path);if($null -eq $entry.value){$key.DeleteValue($name,$false)}else{$value=$entry.value;if($entry.kind -eq 'Binary'){$value=[byte[]]$value};$key.SetValue($name,$value,[Microsoft.Win32.RegistryValueKind]::$($entry.kind))};$key.Dispose()}
}
if($Mode -eq 'clear') {foreach($path in $paths){$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path,$true);if($key){$key.DeleteValue($name,$false);$key.Dispose()}}}
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($paths[0]);$value=$key.GetValue($name);$key.Dispose();@{run=$value} | ConvertTo-Json -Compress

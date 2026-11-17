# Run on a fresh Windows runner after building the NSIS bundle.
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Wait-Button($process, [string]$name) {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "Viewer exited while waiting for $name" }
        if ($process.MainWindowHandle -ne 0) {
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
            $button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
            if ($button -and $button.Current.IsEnabled) { return $button }
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for enabled control: $name"
}

function Invoke-Button($process, [string]$name) {
    $button = Wait-Button $process $name
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

$directory = Join-Path $env:RUNNER_TEMP ('odv-install-' + [guid]::NewGuid())
# NSIS requires /D to be the final, unquoted command-line argument.
$setup = Start-Process -FilePath $Installer -ArgumentList "/S /D=$directory" -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installer exited with $($setup.ExitCode)" }
$viewer = Join-Path $directory 'opendicomviewer-desktop.exe'
if (!(Test-Path -LiteralPath $viewer)) { throw 'Installed viewer binary missing' }

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$app = Start-Process -FilePath $viewer -PassThru
try {
    Invoke-Button $app '载入 CT 预置示例（单层）'
    Invoke-Button $app '导出影像'
    # The button is enabled only after a snapshot is captured and encoded to PNG.
    $null = Wait-Button $app '保存 PNG'
    Write-Output 'Installed viewer opened the bundled CT and prepared its PNG preview.'
} finally {
    if (!$app.HasExited) { Stop-Process -Id $app.Id -Force }
}
$uninstaller = Join-Path $directory 'uninstall.exe'
$remove = Start-Process -FilePath $uninstaller -ArgumentList "/S _?=$directory" -Wait -PassThru
if ($remove.ExitCode -ne 0 -or (Test-Path -LiteralPath $viewer)) { throw 'Uninstall failed' }
Write-Output 'Installed application was removed.'

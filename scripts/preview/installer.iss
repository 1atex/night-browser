#define ProductVersion "0.8.0"
[Setup]
AppId={{7BFD9F1C-A0E3-48D2-A517-116CD33D6D80}
AppName=Night Browser
AppVersion={#ProductVersion}
AppPublisher=Night
AppPublisherURL=https://github.com/1atex/night-browser
AppSupportURL=https://github.com/1atex/night-browser/issues
DefaultDirName={localappdata}\Programs\Night Browser
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\..\dist
OutputBaseFilename=night-browser-{#ProductVersion}-preview-windows-x64-setup
SetupIconFile=..\..\src\night\branding\night.ico
UninstallDisplayIcon={app}\Night.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
CloseApplicationsFilter=Night.exe,NightBrowser.exe
RestartApplications=no
ChangesAssociations=yes
UsePreviousAppDir=yes

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\dist\Night\*"; DestDir: "{app}"; Excludes: "profile,profile-backup-*,import-stage-*,Night.lnk,night-import.json"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "installed.marker"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\Night Browser"; Filename: "{app}\Night.exe"; AppUserModelID: "Night.Browser.Installed"
Name: "{userdesktop}\Night Browser"; Filename: "{app}\Night.exe"; Tasks: desktopicon; AppUserModelID: "Night.Browser.Installed"

[Registry]
Root: HKCU; Subkey: "Software\Classes\NightBrowserHTML"; ValueType: string; ValueData: "Night Browser HTML"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\NightBrowserHTML\DefaultIcon"; ValueType: string; ValueData: "{app}\Night.exe,0"
Root: HKCU; Subkey: "Software\Classes\NightBrowserHTML\shell\open\command"; ValueType: string; ValueData: """{app}\Night.exe"" --url ""%1"""
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser"; ValueType: string; ValueData: "Night Browser"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\DefaultIcon"; ValueType: string; ValueData: "{app}\Night.exe,0"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\shell\open\command"; ValueType: string; ValueData: """{app}\Night.exe"""
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Night Browser"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Night Browser"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: "{app}\Night.exe,0"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities\URLAssociations"; ValueType: string; ValueName: "http"; ValueData: "NightBrowserHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities\URLAssociations"; ValueType: string; ValueName: "https"; ValueData: "NightBrowserHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities\FileAssociations"; ValueType: string; ValueName: ".html"; ValueData: "NightBrowserHTML"
Root: HKCU; Subkey: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities\FileAssociations"; ValueType: string; ValueName: ".htm"; ValueData: "NightBrowserHTML"
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Night Browser"; ValueData: "Software\Clients\StartMenuInternet\NightBrowser\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Night.exe"; Description: "{cm:LaunchProgram,Night Browser}"; Flags: nowait postinstall skipifsilent

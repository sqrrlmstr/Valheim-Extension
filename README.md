# Valheim Vortex Extension - Detects Valheim (Steam and Microsoft Store Usage)
1. Start V## Troubleshooting
- If Valheim isn't detected, ensure it is installed and try launching it once via Steam/MS Store. You can also manually set the path inside Vortex.
- If BepInEx fails to bootstrap, verify the `BepinExInstaller/` folder is present alongside `index.js` and contains the expected files (`BepInEx/`, `winhttp.dll`, `doorstop_config.ini`, etc.).
- **Mod conflicts**: If you experience issues with mods not working together, ensure you're using version 0.2.0+ which creates separate folders for each mod.
- **Config files**: Configuration files (.cfg) are automatically placed in `BepInEx/config/` with flattened structure, regardless of their original archive location.x and select Valheim as the managed game.
2. On first run for a new install, the extension will copy BepInEx from `BepinExInstaller/` into the game directory if it's missing.
3. Install Valheim mods as usual. The installer will automatically:
   - Create separate folders for each mod in `BepInEx/plugins/[ModName]/`
   - Map configuration files to `BepInEx/config/`
   - Prevent conflicts between mods that use the same file namest Store where possible).
- Sets up BepInEx if it isn't already present (from local `BepinExInstaller/`).
- **Organizes mods in separate folders**: Each mod gets its own directory under `BepInEx/plugins/[ModName]/` to prevent file name conflicts.
- Installs mods using Vortex instructions (no direct file I/O), with smart path mapping:
  - Creates individual mod folders based on the primary DLL file name
  - Preserves `BepInEx/**` folders from archives (core, patchers, plugins, config, etc.).
  - Installs config files to `BepInEx/config` with flattened structure for `.cfg` files
  - Places `doorstop_libs/**` at the game root.
  - Installs known doorstop files (e.g., `winhttp.dll`, `doorstop_config.ini`) to the game root.
  - Uses dual installer system: one for DLL plugins, one for configuration filesn

![version](https://img.shields.io/badge/version-0.2.1-informational)
![build](https://img.shields.io/badge/build-local-green)
![status](https://img.shields.io/badge/status-stable-green)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)

A lightweight Vortex extension that adds first-class support for Valheim, including BepInEx setup and smart mod organization with separate mod folders to prevent conflicts when mods share file names (e.g., translations.json).

## What's New in 0.2.1
- **Clean Mod Folder Names**: Automatically removes version numbers and IDs from mod folder names
- **Improved Naming**: Converts "Craft From Containers-40-3-8-3-1751272454" to "Craft_From_Containers"
- **Better Error Handling**: Added null checks and improved robustness
- **Enhanced Logging**: Better visibility into mod installation process

## What it does
- Detects Valheim (Steam and Microsoft Store where possible).
- Sets up BepInEx if it isn’t already present (from local `BepinExInstaller/`).
- Installs mods using Vortex instructions (no direct file I/O), with smart path mapping:
  - Preserves `BepInEx/**` folders from archives (core, patchers, plugins, config, etc.).
  - Installs config files to `BepInEx/config` (keeps subfolders under the last `config/`). (WIP)
  - Places `doorstop_libs/**` at the game root.
  - Installs known doorstop files (e.g., `winhttp.dll`, `doorstop_config.ini`) to the game root.
  - Falls back to `BepInEx/plugins` for other files, relative to the folder containing the primary `.dll`.

## Requirements
- Vortex Mod Manager
- Valheim
- BepInEx (this extension ships a `BepinExInstaller/` folder used to bootstrap when missing)

## Install (developer/local)
There are multiple ways to load local Vortex extensions. A common approach is to place the extension folder into Vortex’s user plugins directory and restart Vortex.

Typical Windows path (may vary by install):
```
%APPDATA%\Vortex\plugins\
```

Alternatively, consult the Vortex documentation for installing/loading local extensions from a folder during development.

## Usage
1. Start Vortex and select Valheim as the managed game.
2. On first run for a new install, the extension will copy BepInEx from `BepinExInstaller/` into the game directory if it’s missing.
3. Install Valheim mods as usual. The installer will map files to correct destinations (see rules above).

## Notes
- **Version 0.2.1** introduces clean mod folder naming to remove messy version numbers and IDs
- The BepInEx presence check uses `BepInEx/core/BepInEx.Preloader.dll` by default.
- The installer returns Vortex copy instructions instead of writing files directly; this keeps deployment and mod management consistent with Vortex.
- Each mod is installed in its own subfolder: `BepInEx/plugins/[CleanModName]/`
- Configuration files (.cfg) are flattened and placed directly in `BepInEx/config/`
- Two specialized installers handle different file types: one for DLL plugins, one for configuration files
- If an archive already contains `BepInEx/**`, that structure is preserved instead of flattening to `plugins`.

## Troubleshooting
- If Valheim isn’t detected, ensure it is installed and try launching it once via Steam/MS Store. You can also manually set the path inside Vortex.
- If BepInEx fails to bootstrap, verify the `BepinExInstaller/` folder is present alongside `index.js` and contains the expected files (`BepInEx/`, `winhttp.dll`, `doorstop_config.ini`, etc.).
- When a mod ships configs outside `config/`, the installer still places `.cfg` files in `BepInEx/config`.

## Folder structure (excerpt)
```
BepinExInstaller/
  BepInEx/
    core/
    plugins/
    config/
  winhttp.dll
  doorstop_config.ini
index.js
info.json

# After installing mods with 0.2.1:
Valheim/
  BepInEx/
    plugins/
      Craft_From_Containers/     # Clean folder name (was Craft From Containers-40-3-8-3-1751272454)
        CraftFromContainers.dll
        assets/
        translations.json
      Valheim_Plus/              # Clean folder name (was ValheimPlus-v0.9.9.15-1234567)
        ValheimPlus.dll  
        translations.json        # No conflict with other mod's file
    config/
      CraftFromContainers.cfg    # Config files are flattened here
      ValheimPlus.cfg
```

## Changelog

### Version 0.2.1 (Current)
- **Added**: Clean mod folder naming system
- **Added**: Automatic removal of version numbers and Nexus IDs from folder names
- **Added**: Filesystem-safe character handling (spaces to underscores, invalid chars removed)
- **Added**: Enhanced error handling with null checks
- **Added**: Improved logging for mod name cleaning process
- **Fixed**: Potential crashes when mod archives don't contain expected DLL files
- **Improved**: Folder organization is now much cleaner and more readable

### Version 0.2.0
- **Added**: Separate mod folders to prevent file conflicts
- **Added**: Smart mod organization based on primary DLL name
- **Added**: Dual installer system (DLL plugins vs configuration files)
- **Added**: Enhanced config handling with flattened structure
- **Added**: Automatic BepInEx bootstrap from local installer
- **Added**: Support for both Steam and Microsoft Store versions
- **Improved**: Path mapping for better mod compatibility

### Version 0.1.7 and earlier
- Basic Valheim game detection
- Initial BepInEx support
- Simple mod installation to BepInEx/plugins

## Contributing
Contributions are welcome! To propose a change:
- Fork and create a feature branch.
- Keep changes focused and add concise descriptions in your commits.
- Test locally in Vortex (ensure install instructions are produced as expected).
- Open a pull request with a short summary and screenshots/logs if relevant.

## License
MIT — see [LICENSE](./LICENSE).

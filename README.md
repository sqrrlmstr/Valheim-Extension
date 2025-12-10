# Valheim Vortex Extension

![version](https://img.shields.io/badge/version-1.1.4-informational)
![build](https://img.shields.io/badge/build-local-green)
![status](https://img.shields.io/badge/status-stable-green)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)

A powerful Vortex extension that adds comprehensive support for Valheim, featuring intelligent BepInEx management, smart conflict resolution, and one-click Thunderstore integration.

## 🚀 What's New in 1.1.4
- **🔧 UI Fix**: Download BepInEx Pack button now only appears when Valheim is the active game

## 🎯 Key Features

### 🎮 Game Support
- **Detects Valheim**: Supports both Steam and Microsoft Store installations
- **Automatic BepInEx Installation**: From local installer OR Thunderstore BepInEx packs
- **One-Click Updates**: Download latest BepInEx pack directly from Thunderstore

### 🧠 Smart Installation System
- **Timestamp-Based Conflict Resolution**: Only installs files when source is newer than existing
- **No Unnecessary Backups**: Intelligent file comparison prevents redundant installations
- **Smart Installer Priority**: BepInEx packs (30) → Regular mods (25) → Configuration files (25)
- **Clean Mod Names**: Automatically removes version numbers and IDs from folder names

### 📁 Organized Mod Management
- **Separate Mod Folders**: Each mod gets its own directory under `BepInEx/plugins/[ModName]/`
- **Prevents File Conflicts**: No more conflicts when mods share file names (e.g., translations.json)
- **Smart Path Mapping**: 
  - Preserves `BepInEx/**` folder structures from archives
  - Installs config files to `BepInEx/config` with flattened structure
  - Places doorstop files at game root
  - Handles Thunderstore package structures automatically

### 🔧 Advanced Features
- **Thunderstore BepInEx Pack Support**: Automatically detects and installs BepInEx packs
- **Multi-location Support**: Different installers for different file types
- **Enhanced Logging**: Comprehensive debugging and status information
- **Error Handling**: Robust error handling with user-friendly notifications

## � Requirements
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
- Valheim (Steam or Microsoft Store)
- BepInEx (automatically installed by this extension if missing)

## Usage
1. Start Vortex and select Valheim as the managed game
2. On first run, the extension will automatically install BepInEx if it's not already present
3. Install Valheim mods as usual through Vortex. The extension will automatically:
   - Create separate folders for each mod in `BepInEx/plugins/[ModName]/`
   - Map configuration files to `BepInEx/config/`
   - Prevent conflicts between mods that use the same file names
   - Clean up mod folder names (removes version numbers and IDs)

## 🛠️ Install (Developer/Local)
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

## 📁 Folder Structure (Example)
```
# Extension files:
BepinExInstaller/
  BepInEx/
    core/
    plugins/
    config/
  winhttp.dll
  doorstop_config.ini
index.js
info.json

# After installing mods with v0.2.7:
Valheim/
  BepInEx/
    plugins/
      Craft_From_Containers/     # Clean folder name (auto-cleaned)
        CraftFromContainers.dll
        assets/
        translations.json
      Valheim_Plus/              # Clean folder name (auto-cleaned)
        ValheimPlus.dll  
        translations.json        # No conflict with other mod's file
    config/
      CraftFromContainers.cfg    # Config files flattened here
      ValheimPlus.cfg
  winhttp.dll                    # BepInEx doorstop files
  doorstop_config.ini
```

## 📝 Changelog

### Version 1.1.4 (Current)
- **🔧 FIXED**: Download BepInEx Pack button now only appears when Valheim is the active game (no longer visible in other games)
- **✅ IMPROVED**: Game-specific UI conditioning for better user experience
- **🎯 ENHANCED**: Dynamic button visibility that updates automatically when switching games

### Version 1.1.3
- **📦 MAJOR UPDATE**: Replaces the prior Valheim extension with enhanced functionality and improved stability
- **🔧 Enhanced System**: All features from 0.3.0 maintained with better integration
- **🛠️ Improved Compatibility**: Better alignment with Vortex extension architecture
- **✅ Unified Experience**: Consolidated modding experience for Valheim users

### Version 0.3.0
- **FIXED**: Improved file permissions handling with unique temporary filenames
- **FIXED**: Enhanced error handling for EPERM (permission denied) errors
- **FIXED**: Added file existence checks and automatic cleanup
- **FIXED**: Proper integration with Vortex download system for installable mods
- **FIXED**: Downloads now properly register with Vortex and show as installable
- **NEW**: Added "Install Now" button for direct installation from notification
- **IMPROVED**: Better error messages with specific troubleshooting suggestions
- **IMPROVED**: Robust file download with conflict resolution
- **IMPROVED**: Better fallback handling when Vortex download API is unavailable
- **IMPROVED**: Enhanced download registration with multiple API approaches

### Version 0.2.9
- **FIXED**: Improved file permissions handling with unique temporary filenames
- **FIXED**: Enhanced error handling for EPERM (permission denied) errors
- **FIXED**: Added file existence checks and automatic cleanup
- **🔧 CRITICAL FIX**: Resolved TypeError "Cannot read properties of undefined (reading 'install')"
- **📁 Improved**: Files now properly appear in Vortex Downloads tab for user installation
- **✅ Enhanced**: Robust file copying and cleanup with comprehensive error handling
- **🛠️ Better**: Graceful fallbacks if automatic download processes fail

### Version 0.2.8
- **🎯 Improved**: React-Bootstrap v0.33.1 compatibility with multiple action registrations
- **🧹 Fixed**: Removed problematic dashlet registration causing render failures
- **📖 Improved**: Code organization with structured constants and cleaner architecture

### Version 0.2.7
- **🚀 MAJOR**: One-click BepInEx pack download from Thunderstore
- **⚡ Added**: Direct Thunderstore API integration for latest version fetching
- **🎯 Added**: "Download Latest BepInEx Pack" button in Vortex interface
- **📊 Enhanced**: Comprehensive logging and error handling

### Version 0.2.6
- **Fixed**: Increased BepInEx pack mod type priority to 30 (ensuring it takes precedence)
- **Added**: Enhanced logging for BepInEx pack detection debugging
- **Added**: Detailed logging in testBepInExPackSync function
- **Added**: Better logging in regular mod installer for conflict detection
- **Improved**: Debugging capabilities to track installer selection issues

### Version 0.2.3
- **Fixed**: Added missing `registerModType` for BepInEx pack installer
- **Fixed**: Added proper destination function `getBepInExPackDestination` 
- **Improved**: BepInEx pack mod type now has priority 20 (higher than regular mods)
- **Improved**: Complete installer registration system for all mod types

### Version 0.2.2
- **Added**: Thunderstore BepInEx pack installer with highest priority (30)
- **Added**: Automatic detection of BepInEx packs from Thunderstore
- **Added**: Smart pattern matching for denikson-BepInExPack_Valheim and similar packages
- **Added**: Proper handling of Thunderstore package folder structures
- **Added**: Enhanced logging for BepInEx pack installation process
- **Improved**: Installation priority system (BepInEx packs → DLL mods → Config files)

### Version 0.2.1
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

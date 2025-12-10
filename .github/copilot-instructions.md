# Valheim Vortex Extension - AI Coding Guide

## Project Overview
This is a **Vortex Mod Manager extension** for Valheim that provides intelligent BepInEx modding support with Thunderstore integration. The extension acts as a bridge between Vortex's mod management system and Valheim's BepInEx modding framework.

## Key Architecture Patterns

### Multi-Tier Installation System
The extension uses a **priority-based installer system** with three distinct types:
- **BepInEx Packs** (priority 30): Full modding framework installations from Thunderstore 
- **DLL Mods** (priority 25): Individual mod plugins (.dll files)
- **Config Mods** (priority 25): Configuration files (.cfg files)

```javascript
// Core pattern: Register installers with test functions and install handlers
context.registerInstaller('bepinex-pack', 30, testBepInExPack, installBepInExPack);
context.registerInstaller('bepinex-dll-mod', 25, testSupportedContent, installContent);
```

### Smart Path Mapping
Mods are intelligently organized into separate folders to prevent conflicts:
- **DLL plugins**: `BepInEx/plugins/[CleanModName]/` (each mod gets its own subfolder)
- **Config files**: `BepInEx/config/` (flattened structure)
- **BepInEx core files**: Game root directory
- **Doorstop files**: Game root (`winhttp.dll`, `doorstop_config.ini`)

### Mod Name Cleaning System
The `cleanModName()` function removes version numbers, Nexus IDs, and invalid characters:
```javascript
// Pattern: Remove -v1.2.3, -123456789, replace spaces with underscores
function cleanModName(rawName) // Handles filesystem-safe naming
```

## Critical Integration Points

### Vortex API Integration
- **Game Detection**: Supports both Steam (`892970`) and Microsoft Store (`9PGW18N0C2G6`) versions
- **Installer Instructions**: Uses Vortex copy instructions instead of direct file I/O
- **Mod Types**: Custom mod types with destination resolvers for different file categories

### Thunderstore API
- **BepInEx Pack Downloads**: Direct integration with `thunderstore.io/api/experimental/`
- **Pattern Detection**: Recognizes `denikson-BepInExPack_Valheim` and similar packages
- **Automatic Installation**: Downloads are registered with Vortex for user installation

### BepInEx Detection Logic
The extension checks for BepInEx presence using `BepInEx/core/BepInEx.Preloader.dll` as the primary indicator. If missing, it automatically installs from the local `BepinExInstaller/` directory.

## Development Workflow

### Key Files and Their Roles
- **`index.js`**: Main extension logic with installer/mod type registrations
- **`info.json`**: Extension metadata (version 1.1.4)
- **`BepinExInstaller/`**: Local BepInEx installation source with pre-configured files
- **`BepinExInstaller/BepInEx/config/BepInEx.cfg`**: Default BepInEx configuration

### Testing Patterns
Each installer has a corresponding test function that examines file lists:
- `testBepInExPack()`: Looks for core BepInEx files and doorstop components
- `testSupportedContent()`: Detects .dll files for plugin mods
- `testSupportedConfigContent()`: Identifies .cfg configuration files

### Constants Organization
The extension uses a structured constants system for maintainability:
```javascript
const CONSTANTS = {
  GAME: { ID: 'valheim', STEAM_APP_ID: '892970' },
  FILE_EXTENSIONS: { MOD: '.dll', CONFIG: '.cfg' },
  THUNDERSTORE: { API_URL: 'https://thunderstore.io/api/...' }
};
```

## Common Debugging Approaches
- **Extensive Logging**: Uses `log('valheim-extension', message)` throughout for debugging
- **Priority Conflicts**: Check installer priorities if mods aren't installing correctly
- **Path Resolution**: Verify `getDiscoveryPath()` returns correct Valheim installation directory
- **BepInEx Detection**: Ensure `BEPINEX_DLL` file exists in expected location

## Extension-Specific Conventions
- **Game-Conditional UI**: Actions/buttons only appear when Valheim is the active game
- **Error Handling**: Comprehensive error handling with user-friendly notifications
- **File Permissions**: Uses unique temporary filenames to handle permission issues
- **Version Numbering**: Follows semantic versioning with detailed changelog tracking

When modifying this extension, always test with both Steam and Microsoft Store versions of Valheim, and ensure the installer priority system correctly handles different mod types.
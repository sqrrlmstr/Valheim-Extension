# Valheim Vortex Extension

![version](https://img.shields.io/badge/version-0.1.7-informational)
![build](https://img.shields.io/badge/build-local-green)
![status](https://img.shields.io/badge/status-experimental-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey)

A lightweight Vortex extension that adds first-class support for Valheim, including BepInEx setup and correct installation of common mod layouts.

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
- The BepInEx presence check uses `BepInEx/core/BepInEx.Preloader.dll` by default.
- The installer returns Vortex copy instructions instead of writing files directly; this keeps deployment and mod management consistent with Vortex.
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
```

## Contributing
Contributions are welcome! To propose a change:
- Fork and create a feature branch.
- Keep changes focused and add concise descriptions in your commits.
- Test locally in Vortex (ensure install instructions are produced as expected).
- Open a pull request with a short summary and screenshots/logs if relevant.

## License
MIT — see [LICENSE](./LICENSE).

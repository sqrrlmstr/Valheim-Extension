// Nexus Mods domain for the game. e.g. nexusmods.com/valheim
const GAME_ID = 'valheim';
//Steam Application ID, you can get this from https://steamdb.info/apps/
const STEAMAPP_ID = '892970';
const MSSTORE_APP_ID = '9PGW18N0C2G6';
const path = require('path'); 
const { fs, log, util } = require('vortex-api');
const MOD_FILE_EXT = ".dll";
const CONFIG_EXT = ".cfg";
const BEPINEX_DLL = "BepInEx.Preloader.dll";

// Function to clean up mod names by removing version numbers and IDs
function cleanModName(rawName) {
  // Remove common version patterns and IDs from mod names
  let cleaned = rawName
    // Remove version patterns like -1-2-3, -v1.2.3, etc.
    .replace(/-v?\d+(?:[.-]\d+)*(?:[.-]\d+)*$/i, '')
    // Remove Nexus ID patterns (long numbers at the end)
    .replace(/-\d{7,}$/, '')
    // Remove additional version patterns like -40-3-8-3
    .replace(/-\d+(?:-\d+){2,}$/, '')
    // Remove any trailing dashes
    .replace(/-+$/, '')
    // Replace multiple dashes with single dash
    .replace(/-{2,}/g, '-')
    // Replace spaces with underscores for better filesystem compatibility
    .replace(/\s+/g, '_')
    // Remove any invalid filesystem characters
    .replace(/[<>:"/\\|?*]/g, '')
    // Trim whitespace and underscores
    .replace(/^[_-]+|[_-]+$/g, '')
    .trim();
  
  // If cleaning resulted in empty string or very short name, use a fallback
  if (!cleaned || cleaned.length < 2) {
    // Use original name but still clean invalid characters
    cleaned = rawName.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').trim();
  }
  
  return cleaned || 'UnknownMod';
}


function main(context) {
  log('valheim-extension', 'Extension initialized and registering Valheim...');

  context.registerGame({
    id: GAME_ID,
    name: 'Valheim',
    mergeMods: true,
    queryPath: findGame, 
    supportedTools: [],
    // Default base for mods; mod types below will override per-type (plugins/config)
    queryModPath: () => path.join('BepInEx', 'plugins'),
    logo: 'gameart.jpg',
    executable: () => 'valheim.exe',
    requiredFiles: ['valheim.exe'], 
    setup: (discovery) => prepareForModding(discovery, context.api), 
    environment: { 
      SteamAPPId: STEAMAPP_ID,
    },
    details: { 
      steamAppId: STEAMAPP_ID,
    },
    requiresLauncher: requiresLauncher,
    });
    log('Valheim extension starting...');
    
  // Installers: plugins first (higher priority), then config
  context.registerInstaller('bepinex-dll-mod', 25, testSupportedContent, installContent);
  context.registerInstaller('bepinex-config-mod', 25, testSupportedConfigContent, installConfigContent);

  // Multi-location mod types similar to Blade & Sorcery to change base per mod type
  const getDiscoveryPath = () => {
    const store = context.api.store;
    const state = store.getState();
    const discovery = util.getSafe(state, ['settings', 'gameMode', 'discovered', GAME_ID], undefined);
    if ((discovery === undefined) || (discovery.path === undefined)) {
      log('error', `${GAME_ID} was not discovered`);
      return '.';
    }
    return discovery.path;
  };

  const getPluginsDestination = () => path.join(getDiscoveryPath(), 'BepInEx', 'plugins');
  const getConfigDestination = () => path.join(getDiscoveryPath(), 'BepInEx', 'config');

  const instructionsHaveExt = (instructions, exts) => {
    const copies = (instructions || []).filter(inst => inst.type === 'copy');
    return copies.some(inst => exts.has(path.posix.extname((inst.destination || '').replace(/\\/g, '/')).toLowerCase()));
  };

  // Prefer plugin type if both match
  context.registerModType('bepinex-dll-modtype', 15, (gameId) => (gameId === GAME_ID),
    getPluginsDestination, (instructions) => Promise.resolve(
      instructionsHaveExt(instructions, new Set([MOD_FILE_EXT]))
    ));

  context.registerModType('bepinex-config-modtype', 15, (gameId) => (gameId === GAME_ID),
    getConfigDestination, (instructions) => Promise.resolve(
      instructionsHaveExt(instructions, new Set([CONFIG_EXT]))
    ));
    return true;
}

async function findGame() {
  // Try Steam first
  try {
    const game = await util.GameStoreHelper.findByAppId([STEAMAPP_ID]);
    if (game && game.gamePath) {
      log('valheim-extension', `Found Valheim via Steam at ${game.gamePath}`);
      return { path: game.gamePath, store: 'steam' };
    }
  } catch (e) {
    log('valheim-extension', 'Steam lookup failed: ' + e.message);
  }

  // Try Microsoft Store
  try {
    const game = await util.GameStoreHelper.findByAppId([MSSTORE_APP_ID]);
    if (game && game.gamePath) {
      log('valheim-extension', `Found Valheim via MS Store at ${game.gamePath}`);
      return { path: game.gamePath, store: 'msstore' };
    }
  } catch (e) {
    log('valheim-extension', 'MS Store lookup failed: ' + e.message);
  }

  log('valheim-extension', 'Game path not found.');
  return undefined;
}

function requiresLauncher(gamePath) {
  return fs.readdirAsync(gamePath)
    .then(files =>
      (files.find(file => file.toLowerCase() === 'steam_appid.txt') !== undefined)
        ? Promise.resolve({
            launcher: 'steam',
            addInfo: {
              appId: STEAMAPP_ID,  // Typically '892970' for Valheim
              parameters: ['-force-glcore'], // Optional game launch parameters
              launchType: 'gamestore', // Or 'steam'
            },
          })
        : Promise.resolve(undefined)
    )
    .catch(err => Promise.reject(err));
}

// Prepare the game for modding by ensuring the necessary folder structure exists.
function prepareForModding(discovery, api) {
  const bepinExPath = path.join(discovery.path, 'BepInEx');
  const bModPath = path.join(bepinExPath, 'core', BEPINEX_DLL);
  const pluginsPath = path.join(bepinExPath, 'plugins');
  const configPath = path.join(bepinExPath, 'config');

  return fs.ensureDirWritableAsync(pluginsPath)
    .then(async () => {
      try {
        await fs.statAsync(bModPath);
        // File exists, ensure config exists and finish
        await fs.ensureDirAsync(configPath);
        return;
      } catch (err) {
        // File does not exist; install BepInEx
        try {
          const localInstallerPath = path.join(__dirname, 'BepinExInstaller');
          log('valheim-extension', 'Installing BepInEx from local files...');
          await fs.copyAsync(localInstallerPath, discovery.path);
          log('valheim-extension', 'BepInEx installed.');
          await fs.ensureDirAsync(pluginsPath); // Ensure plugins folder exists
          await fs.ensureDirAsync(configPath); // Ensure config folder exists
        } catch (installErr) {
          log('valheim-extension', `Error during BepInEx setup: ${installErr.message}`);
          throw installErr;
        }
      }
    });
}

// This function will be called by Vortex to check if the mod is supported.
function testSupportedContent(files, gameId) {
  let supported = (gameId === GAME_ID)
    && (files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT) !== undefined);

  return Promise.resolve({
    supported,
    requiredFiles: ['.dll'],
  });
}

function installContent(files) {
  // The .dll file is expected to always be positioned in the mods directory we're going to disregard anything placed outside the root.
  const modFile = files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT);
  
  if (!modFile) {
    return Promise.reject(new Error('No DLL file found in mod archive'));
  }
  
  const idx = modFile.indexOf(path.basename(modFile));
  const rootPath = path.dirname(modFile);
  
  // Get the mod name from the main DLL file (without extension) and clean it up
  const rawModName = path.basename(modFile, MOD_FILE_EXT);
  const modName = cleanModName(rawModName);
  
  log('valheim-extension', `Installing mod: ${rawModName} -> cleaned: ${modName}`);
  
  // Remove directories and anything that isn't in the rootPath.
  const filtered = files.filter(file => 
    ((file.indexOf(rootPath) !== -1) 
    && (!file.endsWith(path.sep))));

  const instructions = filtered.map(file => {
    return {
      type: 'copy',
      source: file,
      destination: path.join(modName, file.substring(idx)),
    };
  });

  return Promise.resolve({ instructions });
}

// Config installer: targets BepInEx/config under the game root
function testSupportedConfigContent(files, gameId) {
  let supported = (gameId === GAME_ID)
    && (files.find(file => path.extname(file).toLowerCase() === CONFIG_EXT) !== undefined);

  return Promise.resolve({
    supported,
    requiredFiles: ['.cfg'],
  });
}

function installConfigContent(files) {
  const cfgFile = files.find(file => path.extname(file).toLowerCase() === CONFIG_EXT);
  const idx = cfgFile.indexOf(path.basename(cfgFile));
  const rootPath = path.dirname(cfgFile);

  // Remove directories and anything that isn't in the rootPath.
  const filtered = files.filter(file => 
    ((file.indexOf(rootPath) !== -1) 
    && (!file.endsWith(path.sep))));

  const instructions = filtered.map(file => {
    // For config files (.cfg), always use just the filename (flatten completely)
    // For other files, preserve their relative structure
    const destination = path.extname(file).toLowerCase() === CONFIG_EXT
      ? path.basename(file)          // Config files: just the filename
      : file.substring(idx);         // Other files: preserve structure
    
    return {
      type: 'copy',
      source: file,
      destination: destination,
    };
  });

  return Promise.resolve({ instructions });
}

module.exports = {  
    default: main, 
};

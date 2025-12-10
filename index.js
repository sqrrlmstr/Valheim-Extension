// Nexus Mods domain for the game. e.g. nexusmods.com/valheim
const CONSTANTS = {
  GAME: {
    ID: 'valheim',
    STEAM_APP_ID: '892970',
    MSSTORE_APP_ID: '9PGW18N0C2G6'
  },
  FILE_EXTENSIONS: {
    MOD: '.dll',
    CONFIG: '.cfg'
  },
  PATHS: {
    BEPINEX_DLL: 'BepInEx.Preloader.dll'
  },

  THUNDERSTORE: {
    PACKAGE_URL: 'https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/',
    API_URL: 'https://thunderstore.io/api/experimental/package/denikson/BepInExPack_Valheim/',
    FILE_PATTERN: /\.zip$/i
  }
};

// Legacy constants for backward compatibility
const GAME_ID = CONSTANTS.GAME.ID;
const STEAMAPP_ID = CONSTANTS.GAME.STEAM_APP_ID;
const MSSTORE_APP_ID = CONSTANTS.GAME.MSSTORE_APP_ID;
const MOD_FILE_EXT = CONSTANTS.FILE_EXTENSIONS.MOD;
const CONFIG_EXT = CONSTANTS.FILE_EXTENSIONS.CONFIG;
const BEPINEX_DLL = CONSTANTS.PATHS.BEPINEX_DLL;
const path = require('path'); 
const { fs, log, util, actions, selectors } = require('vortex-api');
const https = require('https');

// Simple reducer for session state
function valheimReducer(state = {}, action) {
  switch (action.type) {
    default:
      return state;
  }
}

// BepInEx pack detection patterns
const BEPINEX_PACK_INDICATORS = [
  'BepInEx/core/BepInEx.dll',
  'BepInEx/core/BepInEx.Preloader.dll',
  'BepInEx/plugins/',
  'doorstop_config.ini',
  'winhttp.dll'
];

// Thunderstore BepInEx pack patterns
const THUNDERSTORE_BEPINEX_PATTERNS = [
  /denikson-bepinexpack_valheim/i,
  /bepinexpack.*valheim/i,
  /valheim.*bepinexpack/i
];

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
  try {
    log('valheim-extension', 'Extension initialized and registering Valheim...');
    log('valheim-extension', `Vortex API context available: ${!!context}`);
    log('valheim-extension', `Context registerAction available: ${!!context.registerAction}`);

    // Set up reducer for session state
    context.registerReducer(['session', 'valheim'], valheimReducer);

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
    
    // Register action button - simple approach with internal game checking
    context.registerAction('mod-icons', 100, 'download', {}, 'Download BepInEx Pack', () => {
      downloadLatestBepInExPack(context.api);
    }, () => selectors.currentGame(context.api.store.getState())?.id === GAME_ID);

    log('valheim-extension', 'BepInEx download action registered successfully');
    
  // Installers: BepInEx pack first (highest priority), then plugins, then config
  context.registerInstaller('bepinex-pack', 30, testBepInExPack, (files) => installBepInExPack(files, context.api));
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
  const getBepInExPackDestination = () => getDiscoveryPath(); // BepInEx packs install to game root

  const instructionsHaveExt = (instructions, exts) => {
    const copies = (instructions || []).filter(inst => inst.type === 'copy');
    return copies.some(inst => exts.has(path.posix.extname((inst.destination || '').replace(/\\/g, '/')).toLowerCase()));
  };

  // Helper function to check if instructions contain BepInEx pack indicators
  const hasBepInExPackIndicators = (instructions) => {
    return instructions.some(inst => 
      inst.type === 'copy' && (
        inst.destination.includes('BepInEx/core/') ||
        inst.destination.includes('doorstop_config.ini') ||
        inst.destination.includes('winhttp.dll') ||
        inst.source.includes('BepInEx/core/') ||
        inst.source.includes('doorstop_config.ini') ||
        inst.source.includes('winhttp.dll') ||
        THUNDERSTORE_BEPINEX_PATTERNS.some(pattern => pattern.test(inst.source))
      )
    );
  };

  // Prefer plugin type if both match
  context.registerModType('bepinex-pack-modtype', 30, (gameId) => (gameId === GAME_ID),
    getBepInExPackDestination, (instructions) => {
      const result = hasBepInExPackIndicators(instructions);
      log('valheim-extension', `BepInEx pack mod type test: ${result ? 'MATCHED' : 'not matched'}`);
      return Promise.resolve(result);
    });

  context.registerModType('bepinex-dll-modtype', 15, (gameId) => (gameId === GAME_ID),
    getPluginsDestination, (instructions) => {
      // Don't handle files that look like BepInEx packs
      if (hasBepInExPackIndicators(instructions)) {
        log('valheim-extension', 'DLL mod type: Excluding BepInEx pack files');
        return Promise.resolve(false);
      }
      
      const hasDllFiles = instructionsHaveExt(instructions, new Set([MOD_FILE_EXT]));
      log('valheim-extension', `DLL mod type test: ${hasDllFiles ? 'MATCHED' : 'not matched'}`);
      
      return Promise.resolve(hasDllFiles);
    });

  context.registerModType('bepinex-config-modtype', 15, (gameId) => (gameId === GAME_ID),
    getConfigDestination, (instructions) => {
      // Don't handle files that look like BepInEx packs
      if (hasBepInExPackIndicators(instructions)) {
        log('valheim-extension', 'Config mod type: Excluding BepInEx pack files');
        return Promise.resolve(false);
      }
      
      const hasConfigFiles = instructionsHaveExt(instructions, new Set([CONFIG_EXT]));
      log('valheim-extension', `Config mod type test: ${hasConfigFiles ? 'MATCHED' : 'not matched'}`);
      
      return Promise.resolve(hasConfigFiles);
    });
    
    log('valheim-extension', 'Extension initialization completed successfully');
    return true;
    
  } catch (error) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code || 'unknown'
    };
    log('valheim-extension', `Extension initialization failed: ${JSON.stringify(errorDetails, null, 2)}`);
    
    // Try to show a user notification if API is available
    if (context?.api?.sendNotification) {
      try {
        context.api.sendNotification({
          type: 'error',
          message: `Valheim extension failed to load: ${error.message}`,
          displayMS: 8000
        });
      } catch (notifyError) {
        log('valheim-extension', `Could not send error notification: ${notifyError.message}`);
      }
    }
    
    throw error;
  }
}

async function findGame() {
  log('valheim-extension', 'Starting game detection...');
  
  // Try Steam first
  try {
    log('valheim-extension', `Searching for Steam installation (App ID: ${CONSTANTS.GAME.STEAM_APP_ID})`);
    const game = await util.GameStoreHelper.findByAppId([STEAMAPP_ID]);
    if (game && game.gamePath) {
      log('valheim-extension', `Found Valheim via Steam at ${game.gamePath}`);
      
      // Validate that the path actually contains the game
      const gameExe = path.join(game.gamePath, 'valheim.exe');
      try {
        await fs.statAsync(gameExe);
        log('valheim-extension', 'Steam installation validated - valheim.exe found');
        return { path: game.gamePath, store: 'steam' };
      } catch (validateErr) {
        log('valheim-extension', `Steam path validation failed: valheim.exe not found at ${gameExe}`);
      }
    } else {
      log('valheim-extension', 'Steam search returned no results');
    }
  } catch (e) {
    log('valheim-extension', `Steam lookup failed: ${e.message} (${e.code || 'unknown error'})`);
  }

  // Try Microsoft Store
  try {
    log('valheim-extension', `Searching for Microsoft Store installation (App ID: ${CONSTANTS.GAME.MSSTORE_APP_ID})`);
    const game = await util.GameStoreHelper.findByAppId([MSSTORE_APP_ID]);
    if (game && game.gamePath) {
      log('valheim-extension', `Found Valheim via MS Store at ${game.gamePath}`);
      
      // Validate that the path actually contains the game
      const gameExe = path.join(game.gamePath, 'valheim.exe');
      try {
        await fs.statAsync(gameExe);
        log('valheim-extension', 'MS Store installation validated - valheim.exe found');
        return { path: game.gamePath, store: 'msstore' };
      } catch (validateErr) {
        log('valheim-extension', `MS Store path validation failed: valheim.exe not found at ${gameExe}`);
      }
    } else {
      log('valheim-extension', 'Microsoft Store search returned no results');
    }
  } catch (e) {
    log('valheim-extension', `MS Store lookup failed: ${e.message} (${e.code || 'unknown error'})`);
  }

  log('valheim-extension', 'Game path not found in any supported store. User will need to set path manually.');
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
  log('valheim-extension', `Preparing Valheim for modding at: ${discovery.path}`);
  
  const bepinExPath = path.join(discovery.path, 'BepInEx');
  const bModPath = path.join(bepinExPath, 'core', BEPINEX_DLL);
  const pluginsPath = path.join(bepinExPath, 'plugins');
  const configPath = path.join(bepinExPath, 'config');

  return fs.ensureDirWritableAsync(pluginsPath)
    .then(async () => {
      try {
        await fs.statAsync(bModPath);
        log('valheim-extension', `BepInEx already installed - found ${BEPINEX_DLL}`);
        // File exists, ensure config exists and finish
        await fs.ensureDirAsync(configPath);
        log('valheim-extension', 'BepInEx preparation completed - all folders verified');
        return;
      } catch (err) {
        // File does not exist; install BepInEx
        log('valheim-extension', `BepInEx not found (${err.code || err.message}), installing from local files...`);
        
        try {
          const localInstallerPath = path.join(__dirname, 'BepinExInstaller');
          
          // Verify local installer exists before attempting copy
          try {
            await fs.statAsync(localInstallerPath);
            log('valheim-extension', `Local BepInEx installer found at: ${localInstallerPath}`);
          } catch (installerErr) {
            throw new Error(`Local BepInEx installer not found at ${localInstallerPath}. Please ensure BepinExInstaller folder exists alongside the extension.`);
          }
          
          log('valheim-extension', `Copying BepInEx from ${localInstallerPath} to ${discovery.path}`);
          await fs.copyAsync(localInstallerPath, discovery.path);
          log('valheim-extension', 'BepInEx installation completed successfully');
          
          // Verify installation worked
          await fs.statAsync(bModPath);
          log('valheim-extension', 'BepInEx installation verified - core files present');
          
          await fs.ensureDirAsync(pluginsPath); // Ensure plugins folder exists
          await fs.ensureDirAsync(configPath); // Ensure config folder exists
          log('valheim-extension', 'BepInEx folder structure setup completed');
          
        } catch (installErr) {
          const errorMsg = `Error during BepInEx setup: ${installErr.message}`;
          log('valheim-extension', errorMsg);
          
          // Provide more helpful error information
          if (installErr.message.includes('EACCES') || installErr.message.includes('permission')) {
            throw new Error(`${errorMsg}\n\nThis may be a permissions issue. Try running Vortex as administrator or check that the game directory is writable.`);
          } else if (installErr.message.includes('ENOSPC')) {
            throw new Error(`${errorMsg}\n\nInsufficient disk space. Please free up space and try again.`);
          } else {
            throw new Error(`${errorMsg}\n\nPlease check that the game directory is accessible and writable.`);
          }
        }
      }
    })
    .catch(err => {
      const errorMsg = `Failed to prepare modding environment: ${err.message}`;
      log('valheim-extension', errorMsg);
      throw err;
    });
}

// This function will be called by Vortex to check if the mod is supported.
function testSupportedContent(files, gameId) {
  if (gameId !== GAME_ID) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  log('valheim-extension', `Regular mod installer: Testing ${files.length} files`);

  // Check if this is a BepInEx pack first - if so, don't handle it here
  const isBepInExPack = testBepInExPackSync(files);
  if (isBepInExPack) {
    log('valheim-extension', 'Regular mod installer: Detected BepInEx pack, skipping (should be handled by dedicated installer)');
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  // Only handle regular mods (has .dll but is not a BepInEx pack)
  let supported = (files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT) !== undefined);

  log('valheim-extension', `Regular mod installer: ${supported ? 'SUPPORTED' : 'NOT SUPPORTED'} (found .dll: ${supported})`);

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
  if (gameId !== GAME_ID) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  // Check if this is a BepInEx pack first - if so, don't handle it here  
  const isBepInExPack = testBepInExPackSync(files);
  if (isBepInExPack) {
    log('valheim-extension', 'Config installer: Skipping BepInEx pack (handled by dedicated installer)');
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  // Only handle regular config files (has .cfg but is not a BepInEx pack)
  let supported = (files.find(file => path.extname(file).toLowerCase() === CONFIG_EXT) !== undefined);

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

// BepInEx Pack installer: handles Thunderstore BepInEx packs
function testBepInExPack(files, gameId) {
  // Only for Valheim
  if (gameId !== GAME_ID) {
    log('valheim-extension', 'BepInEx pack installer: Wrong game ID, skipping');
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  log('valheim-extension', `BepInEx pack installer: Testing ${files.length} files`);
  
  // Log first few files for debugging
  files.slice(0, 5).forEach(file => {
    log('valheim-extension', `  File: ${file}`);
  });

  const supported = testBepInExPackSync(files);

  log('valheim-extension', `BepInEx pack detection result: ${supported ? 'SUPPORTED' : 'NOT SUPPORTED'}`);

  return Promise.resolve({
    supported,
    requiredFiles: supported ? ['BepInEx/', 'winhttp.dll'] : [],
  });
}

// Synchronous helper function for BepInEx pack detection (used by other installers)
function testBepInExPackSync(files) {
  log('valheim-extension', 'testBepInExPackSync: Starting detection...');
  
  // Check if this looks like a BepInEx pack
  const hasPackIndicators = BEPINEX_PACK_INDICATORS.some(indicator => 
    files.some(file => file.toLowerCase().includes(indicator.toLowerCase()))
  );
  log('valheim-extension', `  Pack indicators check: ${hasPackIndicators}`);

  // Check for Thunderstore BepInEx pack patterns in filenames
  const hasThunderstorePattern = files.some(file => 
    THUNDERSTORE_BEPINEX_PATTERNS.some(pattern => pattern.test(file))
  );
  log('valheim-extension', `  Thunderstore pattern check: ${hasThunderstorePattern}`);

  // Check for key BepInEx files that indicate this is a full pack
  const hasCoreFiles = files.some(file => file.includes('BepInEx/core/')) && 
                      files.some(file => file.includes('winhttp.dll') || file.includes('doorstop_config.ini'));
  log('valheim-extension', `  Core files check: ${hasCoreFiles}`);

  const result = hasPackIndicators || hasThunderstorePattern || hasCoreFiles;
  log('valheim-extension', `testBepInExPackSync result: ${result}`);
  
  return result;
}

function installBepInExPack(files, api) {
  log('valheim-extension', 'Installing BepInEx pack with timestamp-based conflict resolution...');

  // Get the game discovery path for file checking
  const gameDiscovery = api?.store?.getState?.()?.settings?.gameMode?.discovered?.[GAME_ID];
  const gamePath = gameDiscovery?.path;

  // Filter out directories and get only files
  const filtered = files.filter(file => !file.endsWith(path.sep));

  const instructions = [];

  for (const file of filtered) {
    let destination = file;

    // Handle common Thunderstore pack structure
    // Remove any leading package name folders (e.g., "denikson-BepInExPack_Valheim-5.4.2100/")
    const segments = file.split(/[/\\]/);
    
    // Look for BepInEx folder in the path and start from there
    const bepinExIndex = segments.findIndex(segment => segment.toLowerCase() === 'bepinex');
    if (bepinExIndex !== -1) {
      destination = segments.slice(bepinExIndex).join('/');
    } else {
      // Look for root-level files that should go to game root
      const filename = path.basename(file);
      if (['winhttp.dll', 'doorstop_config.ini', 'changelog.txt'].includes(filename.toLowerCase())) {
        destination = filename;
      } else if (segments.length > 1) {
        // Remove the first segment (package folder) if it exists
        destination = segments.slice(1).join('/');
      }
    }

    // For BepInEx pack files, we want to implement smart versioning
    let shouldInstall = true;
    let reason = 'new file';

    if (gamePath) {
      try {
        const fullDestPath = path.join(gamePath, destination);
        
        // Check if the destination file already exists
        if (fs.existsSync && fs.existsSync(fullDestPath)) {
          // File exists, compare modification times
          const sourceStats = fs.statSync(file);
          const destStats = fs.statSync(fullDestPath);
          
          const sourceTime = sourceStats.mtime.getTime();
          const destTime = destStats.mtime.getTime();
          
          if (sourceTime > destTime) {
            reason = `source is newer (${new Date(sourceTime).toISOString()} > ${new Date(destTime).toISOString()})`;
            shouldInstall = true;
          } else if (sourceTime === destTime) {
            reason = `same timestamp (${new Date(sourceTime).toISOString()}), keeping existing`;
            shouldInstall = false;
          } else {
            reason = `existing is newer (${new Date(destTime).toISOString()} > ${new Date(sourceTime).toISOString()})`;
            shouldInstall = false;
          }
        }
      } catch (err) {
        // If we can't check, install anyway
        const errorDetail = `Could not check timestamp for ${destination}: ${err.message} (${err.code || 'unknown error'})`;
        log('valheim-extension', `${errorDetail}, installing anyway`);
        reason = 'timestamp check failed - installing as fallback';
        shouldInstall = true;
      }
    } else {
      reason = 'no game path available - installing anyway';
      log('valheim-extension', 'Warning: Game path not available for timestamp checking');
    }

    if (shouldInstall) {
      log('valheim-extension', `BepInEx pack file: ${file} -> ${destination} (${reason})`);
      
      instructions.push({
        type: 'copy',
        source: file,
        destination: destination,
        allowReplace: true,  // Force overwrite without backup
      });
    } else {
      log('valheim-extension', `BepInEx pack file skipped: ${file} -> ${destination} (${reason})`);
    }
  }

  const skippedCount = filtered.length - instructions.length;
  log('valheim-extension', `BepInEx pack installation: ${instructions.length} files to install, ${skippedCount} skipped (existing newer/same)`);
  
  return Promise.resolve({ instructions });
}



// Helper function to download a file from URL to local path
async function downloadFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const path = require('path');
    
    // Create a unique temporary filename to avoid conflicts
    const dir = path.dirname(destinationPath);
    const ext = path.extname(destinationPath);
    const base = path.basename(destinationPath, ext);
    const timestamp = Date.now();
    const tempPath = path.join(dir, `${base}_${timestamp}${ext}`);
    
    const file = fs.createWriteStream(tempPath);
    
    const request = https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        log('valheim-extension', `Following redirect to: ${redirectUrl}`);
        // Clean up temp file and retry with redirect
        fs.removeAsync(tempPath).catch(() => {});
        return downloadFile(redirectUrl, destinationPath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        fs.removeAsync(tempPath).catch(() => {});
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', async () => {
        file.close();
        
        try {
          // Check if destination exists and remove it
          try {
            await fs.removeAsync(destinationPath);
          } catch (removeError) {
            // File doesn't exist or can't be removed - that's okay
            log('valheim-extension', `Could not remove existing file (may not exist): ${removeError.message}`);
          }
          
          // Move temp file to final destination
          await fs.moveAsync(tempPath, destinationPath);
          resolve();
        } catch (moveError) {
          // If move fails, at least we have the temp file
          log('valheim-extension', `Could not move to final destination, using temp file: ${moveError.message}`);
          resolve(); // Still resolve since we have the file downloaded
        }
      });
    });
    
    request.on('error', (err) => {
      // Use async remove instead of unlinkSync
      fs.removeAsync(tempPath).catch(() => {
        // Ignore cleanup errors
      });
      reject(new Error(`Network error: ${err.message}`));
    });
    
    file.on('error', (err) => {
      // Use async remove instead of unlinkSync
      fs.removeAsync(tempPath).catch(() => {
        // Ignore cleanup errors
      });
      reject(new Error(`File write error: ${err.message}`));
    });
  });
}

// Function to fetch package info from Thunderstore API
async function fetchThunderstorePackage(apiUrl) {
  return new Promise((resolve, reject) => {
    const request = https.get(apiUrl, {
      headers: {
        'User-Agent': 'Vortex-Valheim-Extension'
      }
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        log('valheim-extension', `API redirect to: ${redirectUrl}`);
        return fetchThunderstorePackage(redirectUrl).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Thunderstore API request failed: HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        // Check if response is HTML instead of JSON (indicates API issues)
        if (data.trim().startsWith('<')) {
          reject(new Error('Thunderstore API returned HTML instead of JSON - API may be down'));
          return;
        }

        try {
          const packageInfo = JSON.parse(data);
          resolve(packageInfo);
        } catch (parseError) {
          log('valheim-extension', `Failed to parse Thunderstore API response: ${data.substring(0, 200)}...`);
          reject(new Error(`Thunderstore API returned invalid JSON: ${parseError.message}`));
        }
      });
    });

    request.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
  });
}

// Fallback function for official releases


// Function to download the latest BepInExPack_Valheim from Thunderstore
async function downloadLatestBepInExPack(api) {
  const API_URL = CONSTANTS.THUNDERSTORE.API_URL;
  
  try {
    log('valheim-extension', 'Starting BepInEx download process...');
    
    // Show notification that download is starting
    api.sendNotification({
      type: 'activity',
      message: 'Downloading latest BepInExPack_Valheim from Thunderstore...',
      displayMS: 3000
    });

    // Get the latest package info from Thunderstore API
    const packageInfo = await fetchThunderstorePackage(API_URL);
    
    if (!packageInfo.latest || !packageInfo.latest.download_url) {
      throw new Error('No download URL found for latest BepInExPack_Valheim');
    }

    const downloadUrl = packageInfo.latest.download_url;
    const versionNumber = packageInfo.latest.version_number;

    log('valheim-extension', `Found BepInExPack_Valheim ${versionNumber} at ${downloadUrl}`);

    api.sendNotification({
      type: 'info',
      message: `Found BepInExPack_Valheim ${versionNumber}. Starting download...`,
      displayMS: 3000
    });

    // Use specific downloads path approach - more reliable and visible
    try {
      // Get Vortex downloads folder path (already game-specific)
      const state = api.store.getState();
      const downloadPath = selectors.downloadPath(state);
      
      if (!downloadPath) {
        throw new Error('Vortex downloads folder not configured. Please set up downloads directory in Vortex settings.');
      }

      const fileName = `BepInExPack_Valheim-${versionNumber}.zip`;
      const fullDownloadPath = path.join(downloadPath, fileName);
      
      log('valheim-extension', `Downloading to specific path: ${fullDownloadPath}`);
      log('valheim-extension', `Download path: ${downloadPath}`);
      log('valheim-extension', `Download URL: ${downloadUrl}`);
      
      // Ensure downloads directory exists
      await fs.ensureDirAsync(downloadPath);
      log('valheim-extension', `Ensured download directory exists: ${downloadPath}`);
      
      api.sendNotification({
        type: 'info',
        message: `Downloading to: ${downloadPath}\\${fileName}`,
        displayMS: 5000
      });
      
      log('valheim-extension', `Starting downloadFile function...`);
      // Download to specific path using our downloadFile helper
      await downloadFile(downloadUrl, fullDownloadPath);
      
      log('valheim-extension', `Download completed successfully to: ${fullDownloadPath}`);
      
      // Verify file exists and has content
      try {
        const stats = await fs.statAsync(fullDownloadPath);
        if (stats.size === 0) {
          throw new Error('Downloaded file is empty');
        }
        log('valheim-extension', `Downloaded file verified: ${stats.size} bytes`);
      } catch (verifyError) {
        throw new Error(`Download verification failed: ${verifyError.message}`);
      }
      
      // Success notification - let the bepinex-pack installer handle installation
      api.sendNotification({
        type: 'success',
        message: `BepInExPack_Valheim ${versionNumber} downloaded successfully!\n\nThe file is ready for installation. Please go to the Downloads tab to install it using the built-in BepInEx pack installer.`,
        displayMS: 0, // Don't auto-dismiss
        actions: [
          {
            title: 'Go to Downloads Tab',
            action: () => {
              // Switch to Downloads tab in Vortex
              api.store.dispatch(actions.setActiveDialog('downloads'));
            }
          },
          {
            title: 'OK',
            action: () => {
              log('valheim-extension', 'User acknowledged BepInEx download completion');
            }
          }
        ]
      });
      
      return fullDownloadPath;
      
    } catch (pathDownloadError) {
      log('valheim-extension', `Path-based download failed: ${pathDownloadError.message}`);
      throw new Error(`Download failed: ${pathDownloadError.message}`);
    }

  } catch (error) {
    const errorMsg = `Error downloading BepInExPack_Valheim: ${error.message}`;
    log('valheim-extension', errorMsg);
    
    // Provide helpful suggestions based on error type
    let userMessage = `Failed to download BepInExPack_Valheim: ${error.message}`;
    
    if (error.message.includes('Network error') || error.message.includes('ENOTFOUND')) {
      userMessage += '\n\nSuggestions:\n• Check your internet connection\n• Verify Thunderstore is accessible\n• Try again in a few minutes';
    } else if (error.message.includes('HTTP 403') || error.message.includes('rate limiting')) {
      userMessage += '\n\nSuggestions:\n• Thunderstore API rate limit exceeded\n• Wait and try again';
    } else if (error.message.includes('HTTP 404')) {
      userMessage += '\n\nSuggestions:\n• Package may not exist\n• Extension may need updating';
    } else if (error.message.includes('HTML instead of JSON')) {
      userMessage += '\n\nSuggestions:\n• Thunderstore API may be down\n• Try again later';
    }
    
    userMessage += '\n\nAlternative: Download BepInExPack_Valheim manually from https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/';
    
    api.sendNotification({
      type: 'error',
      message: userMessage,
      displayMS: 10000
    });
    
    throw error;
  }
}

module.exports = {  
    default: main, 
};

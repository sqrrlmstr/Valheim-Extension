// Nexus Mods domain for the game. e.g. nexusmods.com/valheim
const GAME_ID = 'valheim';
//Steam Application ID, you can get this from https://steamdb.info/apps/
const STEAMAPP_ID = '892970';
const MSSTORE_APP_ID = '9PGW18N0C2G6';
const path = require('path'); 
const { fs, log, util } = require('vortex-api');
const MOD_FILE_EXT = ".dll";
const BEPINEX_DLL = "BepInEx.Preloader.dll";


function main(context) {
  log('valheim-extension', 'Extension initialized and registering Valheim...');

  context.registerGame({
    id: GAME_ID,
    name: 'Valheim',
    mergeMods: false,
    queryPath: findGame, 
    supportedTools: [],
    queryModPath: () => 'BepInEx/plugins',
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
    
    // Priority 25 ensures BepInEx mods are installed before other generic installers.
    const BEPINEX_INSTALLER_PRIORITY = 25;
    context.registerInstaller('bepinex-mod', BEPINEX_INSTALLER_PRIORITY, testSupportedContent, installContent);
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

    return fs.ensureDirWritableAsync(pluginsPath)
        .then(async () => {
            try {
                await fs.stat(bModPath);
                // File exists, nothing more to do
                return;
            } catch (err) {
                // File does not exist; install BepInEx
                try {
                    const localInstallerPath = path.join(__dirname, 'BepinExInstaller');
                    log('valheim-extension', 'Installing BepInEx from local files...');
                    await copyFolderAsync(localInstallerPath, discovery.path); 
                    log('valheim-extension', 'BepInEx installed.');
                    await fs.ensureDirAsync(pluginsPath); // Ensure plugins folder exists
                } catch (installErr) {
                    log('valheim-extension', `Error during BepInEx setup: ${installErr.message}`);
                    throw installErr;
                }
            }
        });
}

// Utility function to copy a file
async function copyFileAsync(src, dest) {
  return new Promise((resolve, reject) => {
    const rd = fs.createReadStream(src);
    const wr = fs.createWriteStream(dest);
    rd.on('error', reject);
    wr.on('error', reject);
    wr.on('close', resolve);
    rd.pipe(wr);
  });
}

// Utility function to copy a folder recursively
async function copyFolderAsync(src, dest) {
  const entries = await fs.readdirAsync(src, { withFileTypes: true });

  await fs.ensureDirAsync(dest);

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyFolderAsync(srcPath, destPath);
    } else {
      await copyFileAsync(srcPath, destPath);
    }
  }
}

// This function will be called by Vortex to check if the mod is supported.
function testSupportedContent(files, gameId) {
    let supported = (gameId === GAME_ID) && 
        (files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT) !== undefined); 

    return Promise.resolve({ 
        supported, 
        requiredFiles: [],
    });
}

async function installContent(files) {
  // Vortex expects install instructions, not direct file IO. We'll preserve
  // the BepInEx/doorstop layout if present, otherwise fall back to plugins.
  const normalizedFiles = files.map(f => f.replace(/\\/g, '/'));

  const modFile = normalizedFiles.find(file =>
    path.extname(file).toLowerCase() === MOD_FILE_EXT.toLowerCase()
  );
  if (!modFile) return { instructions: [] };

  const modRoot = path.posix.dirname(modFile);
  const instructions = [];

  const ROOT_FILES = new Set([
    'doorstop_config.ini',
    'winhttp.dll',
    'start_game_bepinex.sh',
    'start_server_bepinex.sh',
  ]);

  for (const file of normalizedFiles) {
    if (file.endsWith('/')) continue; // skip folders

    const lower = file.toLowerCase();
    const fileExt = path.extname(file).toLowerCase();

    let destination;

    // 1) Preserve any BepInEx folder structure found in the archive
    const bepinIdx = lower.indexOf('/bepinex/');
    if (bepinIdx !== -1) {
      destination = file.substring(bepinIdx + 1); // keep 'BepInEx/...'
    }

    // 2) Config files anywhere -> BepInEx/config (preserve subpath under last config/)
    if (!destination) {
      const configIdx = lower.lastIndexOf('config/');
      if (fileExt === '.cfg' || configIdx !== -1) {
        let relative;
        if (configIdx !== -1) {
          relative = file.substring(configIdx + 'config/'.length);
        } else {
          relative = path.posix.basename(file);
        }
        destination = path.posix.join('BepInEx/config', relative);
      }
    }

    // 3) doorstop_libs folder -> preserve under game root
    if (!destination) {
      const doorstopLibIdx = lower.indexOf('/doorstop_libs/');
      if (doorstopLibIdx !== -1) {
        destination = file.substring(doorstopLibIdx + 1); // keep 'doorstop_libs/...'
      }
    }

    // 4) Known root files -> to game root
    if (!destination) {
      const base = path.posix.basename(lower);
      if (ROOT_FILES.has(base)) {
        destination = path.posix.basename(file);
      }
    }

    // 5) Fallback: put relative to the DLL's folder into BepInEx/plugins
    if (!destination) {
      const relative = path.posix.relative(modRoot, file);
      destination = path.posix.join('BepInEx/plugins', relative);
    }

    instructions.push({ type: 'copy', source: file, destination });
    log('valheim-extension', `Installing file from ${file} to ${destination}`);
  }

  log('valheim-extension', `Installer returning ${instructions.length} instructions`);
  if (instructions.length === 0) {
    log('valheim-extension', 'No valid files found for installation.');
  }
  return { instructions };
}

module.exports = {  
    default: main, 
};

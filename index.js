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

  NEXUS: {
    DOMAIN: 'valheim',
    MOD_ID: 3605
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
const pendingBepInExDownloads = new Set();
const pendingBepInExReplacements = new Map();
const activeBepInExInstalls = new Map();
const disabledBepInExDependents = new Map();
let disabledBepInExDependentsFile;
let disabledBepInExDependentsLoaded = Promise.resolve();
let disabledBepInExDependentsSaveQueue = Promise.resolve();
let bepInExInstallPromise;

// Simple reducer for session state
function valheimReducer(state = {}, action) {
  switch (action.type) {
    default:
      return state;
  }
}

function initializeDisabledBepInExDependents(api) {
  try {
    if (typeof api.getVortexPath !== 'function') {
      throw new Error('Vortex user data path is unavailable');
    }

    disabledBepInExDependentsFile = path.join(
      api.getVortexPath('userData'),
      'valheim-extension',
      'disabled-bepinex-dependents.json',
    );
  } catch (error) {
    log('valheim-extension', `Could not locate restore-state file: ${error.message}`);
    return Promise.resolve();
  }

  return fs.readFileAsync(disabledBepInExDependentsFile, 'utf8')
    .then(contents => {
      const savedState = JSON.parse(contents);
      if (savedState.version !== 1 || typeof savedState.profiles !== 'object') {
        throw new Error('Unsupported restore-state file format');
      }

      Object.entries(savedState.profiles).forEach(([profileId, modIds]) => {
        if (Array.isArray(modIds)) {
          disabledBepInExDependents.set(profileId, modIds.filter(modId => typeof modId === 'string'));
        }
      });
    })
    .catch(error => {
      if (error.code !== 'ENOENT') {
        log('valheim-extension', `Could not load restore-state file: ${error.message}`);
      }
    });
}

function persistDisabledBepInExDependents() {
  if (!disabledBepInExDependentsFile) {
    return Promise.resolve();
  }

  const contents = JSON.stringify({
    version: 1,
    profiles: Object.fromEntries(disabledBepInExDependents),
  }, null, 2);

  disabledBepInExDependentsSaveQueue = disabledBepInExDependentsSaveQueue
    .catch(() => undefined)
    .then(async () => {
      await fs.ensureDirAsync(path.dirname(disabledBepInExDependentsFile));
      await fs.writeFileAsync(disabledBepInExDependentsFile, contents, 'utf8');
    })
    .catch(error => {
      log('valheim-extension', `Could not save restore-state file: ${error.message}`);
    });

  return disabledBepInExDependentsSaveQueue;
}

// BepInEx pack detection patterns
const BEPINEX_PACK_INDICATORS = [
  'BepInEx/core/BepInEx.dll',
  'BepInEx/core/BepInEx.Preloader.dll',
  'BepInEx/plugins/',
  'doorstop_config.ini',
  'winhttp.dll'
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

function isBepInExMod(mod) {
  if (!mod) {
    return false;
  }

  const attributes = mod.attributes || {};
  const name = `${attributes.name || ''} ${mod.id || ''}`.toLowerCase();
  return mod.type === 'bepinex-pack-modtype'
    || Number(attributes.modId) === CONSTANTS.NEXUS.MOD_ID
    || name.includes('bepinexpack_valheim')
    || name.includes('bepinexpack-valheim');
}

function getBepInExMods(api, gameId = GAME_ID) {
  const mods = util.getSafe(api.getState(), ['persistent', 'mods', gameId], {});
  return Object.values(mods).filter(isBepInExMod);
}

function getBepInExMod(api, gameId = GAME_ID) {
  return getBepInExMods(api, gameId)[0];
}

function hasNexusFileId(record, fileId) {
  const nexusRecords = [
    record,
    record?.nexus?.ids,
    record?.modInfo?.nexus?.ids,
    record?.modInfo?.meta?.ids,
    record?.meta?.ids,
    record?.attributes,
  ];

  return nexusRecords.some(ids => Number(ids?.modId) === CONSTANTS.NEXUS.MOD_ID
    && String(ids?.fileId || ids?.file_id) === String(fileId));
}

function findBepInExDownload(api, fileId) {
  const downloads = util.getSafe(api.getState(), ['persistent', 'downloads', 'files'], {});
  return Object.entries(downloads).find(([, download]) => hasNexusFileId(download, fileId));
}

async function installBepInExFromNexus(api, force = false) {
  const installedMod = getBepInExMod(api);
  if (!force && installedMod) {
    return installedMod;
  }
  const modsToReplace = force ? getBepInExMods(api) : [];
  const profilesWithBepInExEnabled = Object.entries(
    util.getSafe(api.getState(), ['persistent', 'profiles'], {}),
  )
    .filter(([, profile]) => modsToReplace.some(mod =>
      util.getSafe(profile, ['modState', mod.id, 'enabled'], false)))
    .map(([profileId]) => profileId);
  if (bepInExInstallPromise) {
    return bepInExInstallPromise;
  }

  const installPromise = (async () => {
    try {
      if (typeof api.ext?.nexusGetModFiles !== 'function') {
        throw new Error('Vortex Nexus integration is unavailable');
      }

      const files = await api.ext.nexusGetModFiles(GAME_ID, CONSTANTS.NEXUS.MOD_ID);
      const mainFile = files
        .filter(file => Number(file.category_id || file.categoryId) === 1
          || file.is_primary === true
          || file.isPrimary === true)
        .sort((left, right) => (right.uploaded_timestamp || right.uploadedTimestamp || 0)
          - (left.uploaded_timestamp || left.uploadedTimestamp || 0))[0];

      const fileId = mainFile?.file_id || mainFile?.fileId;
      if (!fileId) {
        throw new Error('No current main BepInEx file was returned by Nexus');
      }

      const currentFileMod = getBepInExMods(api).find(mod => hasNexusFileId(mod, fileId));
      if (force && currentFileMod) {
        log('valheim-extension', `BepInEx file ${fileId} is already installed; skipping duplicate download`);
        api.sendNotification({
          type: 'info',
          message: 'BepInExPack_Valheim is already up to date.',
          displayMS: 5000,
        });
        return currentFileMod;
      }

      const existingDownload = findBepInExDownload(api, fileId);
      if (existingDownload) {
        const [downloadId, download] = existingDownload;
        pendingBepInExDownloads.add(downloadId);
        pendingBepInExReplacements.set(downloadId, {
          modIds: modsToReplace.map(mod => mod.id),
          enabledProfileIds: profilesWithBepInExEnabled,
        });
        log('valheim-extension', `Reusing existing BepInEx download ${downloadId} (${download.state})`);
        if (download.state === 'finished') {
          return await installFinishedBepInExDownload(api, downloadId);
        }
        return await waitForBepInExInstall(api, downloadId);
      }

      const fileName = mainFile.file_name || mainFile.fileName || mainFile.name || `BepInExPack_Valheim-${fileId}.zip`;
      const nxmUrl = `nxm://${CONSTANTS.NEXUS.DOMAIN}/mods/${CONSTANTS.NEXUS.MOD_ID}/files/${fileId}`;
      log('valheim-extension', `BepInEx is missing; requesting current Nexus main file ${nxmUrl}`);

      const downloadId = await util.toPromise((cb) => api.events.emit(
        'start-download',
        [nxmUrl],
        {
          game: GAME_ID,
          source: 'nexus',
          name: fileName,
          nexus: {
            ids: {
              gameId: CONSTANTS.NEXUS.DOMAIN,
              modId: CONSTANTS.NEXUS.MOD_ID,
              fileId,
            },
          },
        },
        fileName,
        cb,
        'never',
        { allowInstall: false },
      ));
      if (!downloadId) {
        throw new Error('Vortex did not return a download ID');
      }

      pendingBepInExDownloads.add(downloadId);
      pendingBepInExReplacements.set(downloadId, {
        modIds: modsToReplace.map(mod => mod.id),
        enabledProfileIds: profilesWithBepInExEnabled,
      });
      log('valheim-extension', `BepInEx download requested as ${downloadId}; waiting for installation`);
      return await waitForBepInExInstall(api, downloadId);
    } catch (error) {
      log('valheim-extension', `Automatic BepInEx installation failed: ${error.message}`);
      api.sendNotification({
        type: 'warning',
        message: `BepInExPack_Valheim was not installed automatically: ${error.message}. Install it from Nexus Mods before enabling Valheim mods.`,
        displayMS: 10000,
      });
      throw error;
    }
  })();

  bepInExInstallPromise = installPromise;
  try {
    return await installPromise;
  } finally {
    if (bepInExInstallPromise === installPromise) {
      bepInExInstallPromise = undefined;
    }
  }
}

function waitForBepInExInstall(api, downloadId) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      handler(value);
    };

    const checkDownload = () => {
      const download = util.getSafe(api.getState(), ['persistent', 'downloads', 'files', downloadId], undefined);
      if (download?.state === 'finished') {
        installFinishedBepInExDownload(api, downloadId).then(
          mod => finish(resolve, mod),
          error => finish(reject, error),
        );
      } else if (['failed', 'cancelled', 'error'].includes(download?.state)) {
        pendingBepInExDownloads.delete(downloadId);
        finish(reject, new Error(`BepInEx download ${download.state}`));
      }
    };

    unsubscribe = api.store.subscribe(checkDownload);
    checkDownload();
  });
}

function installFinishedBepInExDownload(api, downloadId) {
  if (activeBepInExInstalls.has(downloadId)) {
    return activeBepInExInstalls.get(downloadId);
  }

  const download = util.getSafe(api.getState(), ['persistent', 'downloads', 'files', downloadId], undefined);
  if (!download || download.state !== 'finished') {
    return Promise.resolve(undefined);
  }

  pendingBepInExDownloads.delete(downloadId);
  const replacement = pendingBepInExReplacements.get(downloadId) || { modIds: [], enabledProfileIds: [] };
  const installPromise = util.toPromise((cb) => api.events.emit(
    'start-install-download',
    downloadId,
    replacement.modIds.length === 0,
    cb,
  )).then(async installedModId => {
    const gameMods = util.getSafe(api.getState(), ['persistent', 'mods', GAME_ID], {});
    const bepinexMod = gameMods[installedModId]
      || getBepInExMods(api).find(mod => !replacement.modIds.includes(mod.id));
    if (!bepinexMod) {
      throw new Error('Vortex finished installing BepInEx but did not register the mod');
    }

    log('valheim-extension', `BepInEx download ${downloadId} installed as ${bepinexMod.id}`);
    if (replacement.enabledProfileIds.length > 0 && typeof actions.setModsEnabled !== 'function') {
      throw new Error('Vortex cannot preserve BepInEx enabled state during the update');
    }

    for (const profileId of replacement.enabledProfileIds) {
      await actions.setModsEnabled(api, profileId, [bepinexMod.id], true, {
        allowAutoDeploy: false,
        reason: 'bepinex-update',
      });
    }

    for (const oldModId of replacement.modIds) {
      if (oldModId !== bepinexMod.id) {
        await util.toPromise(cb => api.events.emit('remove-mod', GAME_ID, oldModId, cb));
        log('valheim-extension', `Removed superseded BepInEx mod ${oldModId}`);
      }
    }

    return bepinexMod;
  }).catch(error => {
    log('valheim-extension', `BepInEx installation failed for ${downloadId}: ${error.message}`);
    throw error;
  }).finally(() => {
    pendingBepInExReplacements.delete(downloadId);
  });
  activeBepInExInstalls.set(downloadId, installPromise);
  return installPromise.then(
    mod => {
      activeBepInExInstalls.delete(downloadId);
      return mod;
    },
    error => {
      activeBepInExInstalls.delete(downloadId);
      throw error;
    },
  );
}

function downloadLatestBepInExPack(api) {
  return installBepInExFromNexus(api, true).catch(error => {
    log('valheim-extension', `BepInEx button action failed safely: ${error.message}`);
  });
}

async function ensureBepInExEnabled(api, profileId) {
  if (!profileId) {
    throw new Error('Cannot enable BepInEx without an active Valheim profile');
  }

  let bepinexMod = getBepInExMod(api);
  if (!bepinexMod) {
    bepinexMod = await installBepInExFromNexus(api);
  }

  if (!bepinexMod) {
    throw new Error('BepInExPack_Valheim must be installed before Valheim mods can be enabled');
  }

  const bepinexEnabled = util.getSafe(api.getState(), ['persistent', 'profiles', profileId, 'modState', bepinexMod.id, 'enabled'], false);
  if (!bepinexEnabled) {
    if (typeof actions.setModsEnabled !== 'function') {
      throw new Error('Vortex cannot enable BepInExPack_Valheim automatically');
    }

    log('valheim-extension', `Enabling BepInEx in profile ${profileId}`);
    await actions.setModsEnabled(api, profileId, [bepinexMod.id], true, {
      allowAutoDeploy: false,
      reason: 'bepinex-prerequisite',
    });
  }

  const isEnabled = util.getSafe(api.getState(), ['persistent', 'profiles', profileId, 'modState', bepinexMod.id, 'enabled'], false);
  if (!isEnabled) {
    api.sendNotification({
      type: 'warning',
      message: 'Enable BepInExPack_Valheim before enabling Valheim mods.',
      displayMS: 8000,
    });
    throw new Error('BepInExPack_Valheim must be enabled before Valheim mods can be enabled');
  }

  return bepinexMod;
}

async function enforceBepInExDependency(api, profileId, modIds, enabled) {
  if (!enabled) {
    return;
  }

  const mods = util.getSafe(api.getState(), ['persistent', 'mods', GAME_ID], {});
  const hasValheimMods = modIds
    .map(modId => mods[modId])
    .some(mod => mod && !isBepInExMod(mod));

  if (hasValheimMods) {
    await ensureBepInExEnabled(api, profileId);
  }
}

async function restoreValheimModsWhenBepInExEnabled(api, modIds, enabled, gameId) {
  if (gameId !== GAME_ID) {
    return;
  }

  await disabledBepInExDependentsLoaded;
  const state = api.getState();
  const profileId = util.getSafe(state, ['settings', 'profiles', 'activeProfileId'], undefined);
  const bepinexMod = getBepInExMod(api);
  if (!profileId || !bepinexMod || !modIds.includes(bepinexMod.id)) {
    return;
  }

  const mods = util.getSafe(state, ['persistent', 'mods', GAME_ID], {});
  if (!enabled) {
    const enabledModIds = Object.values(mods)
      .filter(mod => !isBepInExMod(mod)
        && util.getSafe(state, ['persistent', 'profiles', profileId, 'modState', mod.id, 'enabled'], false))
      .map(mod => mod.id);

    if (enabledModIds.length > 0) {
      const previouslyDisabled = disabledBepInExDependents.get(profileId) || [];
      disabledBepInExDependents.set(profileId, [...new Set([...previouslyDisabled, ...enabledModIds])]);
      await persistDisabledBepInExDependents();
      if (typeof actions.setModsEnabled !== 'function') {
        log('valheim-extension', 'Vortex cannot disable dependent mods automatically');
        return;
      }
      log('valheim-extension', `BepInEx disabled; disabling ${enabledModIds.length} dependent mod(s)`);
      await actions.setModsEnabled(api, profileId, enabledModIds, false, {
        allowAutoDeploy: false,
        reason: 'bepinex-disabled',
      });
    }
    return;
  }

  const pendingModIds = disabledBepInExDependents.get(profileId);
  if (!pendingModIds || pendingModIds.length === 0) {
    return;
  }

  const installedModIds = pendingModIds.filter(modId => mods[modId]);
  if (installedModIds.length > 0) {
    if (typeof actions.setModsEnabled !== 'function') {
      log('valheim-extension', 'Vortex cannot restore dependent mods automatically');
      return;
    }
    log('valheim-extension', `BepInEx enabled; restoring ${installedModIds.length} dependent mod(s)`);
    await actions.setModsEnabled(api, profileId, installedModIds, true, {
      allowAutoDeploy: false,
      reason: 'bepinex-restored',
    });
  }

  disabledBepInExDependents.delete(profileId);
  await persistDisabledBepInExDependents();
}


function main(context) {
  try {
    log('valheim-extension', 'Extension initialized and registering Valheim...');
    log('valheim-extension', `Vortex API context available: ${!!context}`);
    log('valheim-extension', `Context registerAction available: ${!!context.registerAction}`);
    disabledBepInExDependentsLoaded = initializeDisabledBepInExDependents(context.api);

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

    context.once(() => {
      const apiEvents = context.api.events;
      if (typeof context.api.onAsync === 'function') {
        context.api.onAsync('will-enable-mods', (profileId, modIds, enabled) =>
          enforceBepInExDependency(context.api, profileId, modIds, enabled));
      } else if (typeof apiEvents?.on === 'function') {
        apiEvents.on('will-enable-mods', (profileId, modIds, enabled) => {
          enforceBepInExDependency(context.api, profileId, modIds, enabled).catch(error => {
            log('valheim-extension', `BepInEx enable check failed: ${error.message}`);
          });
        });
      } else {
        log('valheim-extension', 'No compatible Vortex event API found; BepInEx enable checks are unavailable');
      }

      if (typeof apiEvents?.on !== 'function') {
        log('valheim-extension', 'Vortex event emitter is unavailable; automatic BepInEx installation is unavailable');
        return;
      }

      apiEvents.on('mods-enabled', (modIds, enabled, gameId) => {
        restoreValheimModsWhenBepInExEnabled(context.api, modIds, enabled, gameId).catch(error => {
          log('valheim-extension', `BepInEx dependent mod state update failed: ${error.message}`);
        });
      });
      apiEvents.on('gamemode-activated', (gameId) => {
        if (gameId === GAME_ID) {
          installBepInExFromNexus(context.api).catch(error => {
            log('valheim-extension', `Automatic BepInEx installation failed: ${error.message}`);
          });
        }
      });
      apiEvents.on('did-finish-download', (downloadId) => {
        if (pendingBepInExDownloads.has(downloadId)) {
          installFinishedBepInExDownload(context.api, downloadId).catch(error => {
            log('valheim-extension', `BepInEx download installation failed: ${error.message}`);
          });
        }
      });
    });
    log('Valheim extension starting...');

    context.registerAction('mod-icons', 100, 'download', {}, 'Download Latest BepInEx Pack', () => {
      log('valheim-extension', 'BepInEx download button clicked');
      return downloadLatestBepInExPack(context.api);
    }, () => selectors.currentGame(context.api.store.getState())?.id === GAME_ID);
    
  // Installers: BepInEx pack first (highest priority), then plugins, then config
  context.registerInstaller('bepinex-pack', 30, testBepInExPack, (files) => installBepInExPack(files, context.api));
  const installWithBepInEx = (installer) => async (files) => {
    const profileId = util.getSafe(context.api.getState(), ['settings', 'profiles', 'activeProfileId'], undefined);
    await ensureBepInExEnabled(context.api, profileId);
    return installer(files);
  };
  context.registerInstaller('bepinex-dll-mod', 25, testSupportedContent, installWithBepInEx(installContent));
  context.registerInstaller('bepinex-config-mod', 25, testSupportedConfigContent, installWithBepInEx(installConfigContent));

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
        inst.source.includes('winhttp.dll')
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

// Prepare the game for modding without installing files outside Vortex deployment.
function prepareForModding(discovery) {
  log('valheim-extension', `Preparing Valheim for modding at: ${discovery.path}`);
  
  const bepinExPath = path.join(discovery.path, 'BepInEx');
  const bModPath = path.join(bepinExPath, 'core', BEPINEX_DLL);
  const pluginsPath = path.join(bepinExPath, 'plugins');
  const configPath = path.join(bepinExPath, 'config');

  return Promise.all([
    fs.statAsync(bModPath).then(() => {
      log('valheim-extension', `BepInEx is available through Vortex deployment - found ${BEPINEX_DLL}`);
    }).catch(() => {
      log('valheim-extension', 'BepInEx is not currently deployed; no files were installed automatically');
    }),
    fs.ensureDirAsync(pluginsPath),
    fs.ensureDirAsync(configPath),
  ]);
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
  // Select the first DLL as the basis for the installation folder.
  let modFile = files.find(file => path.extname(file).toLowerCase() === MOD_FILE_EXT);

  if (!modFile) {
    return Promise.reject(new Error('No DLL file found in mod archive'));
  }

  const idx = modFile.indexOf(path.basename(modFile));
  const rootPath = path.dirname(modFile);
  
  // Get the mod name from the main DLL file (without extension) and clean it up
  const rawModName = path.basename(modFile, MOD_FILE_EXT);
  let modName = cleanModName(rawModName);
  
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

// BepInEx Pack installer: handles archives installed at the game root
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

  // Check for key BepInEx files that indicate this is a full pack
  const hasCoreFiles = files.some(file => file.includes('BepInEx/core/')) && 
                      files.some(file => file.includes('winhttp.dll') || file.includes('doorstop_config.ini'));
  log('valheim-extension', `  Core files check: ${hasCoreFiles}`);

  const result = hasPackIndicators || hasCoreFiles;
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

    // Handle package-root folders commonly included in BepInEx archives
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



module.exports = {  
    default: main, 
};


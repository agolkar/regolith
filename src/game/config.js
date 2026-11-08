// Regolith — single source of tunable constants and asset keys.
// Plain frozen object, no imports.

const CONFIG = Object.freeze({
  // ---------------------------------------------------------------- meta
  title: 'REGOLITH',
  logline: 'Scoop the dust, sinter the feedstock, print a home — and cut the cord to Earth.',
  level: 1,

  // ---------------------------------------------------------------- run
  runLength: 240,                 // seconds in the surface window
  modulesToWin: 5,
  independencePerModule: 20,      // percent, capped at 100
  scoreIndependenceWeight: 1000,
  scoreTimeWeight: 15,
  saveKeyBest: 'regolith.best',
  saveKeyIntroSeen: 'regolith.introSeen',

  // ---------------------------------------------------------------- rover
  rover: {
    cruiseSpeed: 9,               // m/s
    boostSpeed: 14,               // m/s
    hitSpeed: 4,                  // m/s after a boulder hit
    hitSlowTime: 1.0,             // s
    accel: 6,                     // m/s^2 toward target speed
    turnRate: 1.6,                // rad/s
    bodyHalfHeight: 0.6,          // chassis centre above ground
    collisionRadius: 1.4,         // m, boulder overlap radius
    slopeLimitDeg: 20,
    slopeSpeedFactor: 0.5,
    slopeShakeInterval: 0.5,      // s between slope shakes
    slopeShakeIntensity: 0.2,
    slopeShakeDuration: 0.2,
    hitShakeIntensity: 0.4,
    hitShakeDuration: 0.3,
    boostMinBattery: 10,
    startX: 0,
    startZ: 0,
  },

  // ---------------------------------------------------------------- battery
  battery: {
    max: 100,
    drainDrive: 1,                // per second while driving
    drainBoost: 3,                // per second while boosting
    drainScoop: 2,                // per second while scooping
    rechargeSun: 3,               // per second in sunlight
    rechargeSolarModule: 2,       // per second per completed solar module
    emergencyReserve: 8,          // seconds after battery reaches 0
    lowPowerThreshold: 20,        // percent, triggers warning voice
    lowPowerTickInterval: 1.0,    // s between tick sounds
  },

  // ---------------------------------------------------------------- integrity
  integrity: {
    max: 100,
    boulderHit: 2,
    meteorOuter: 8,               // integrity lost within outer radius
    meteorInner: 20,              // integrity lost within inner radius
    flareDrain: 1,                // per second while exposed
    domeBonus: 15,
  },

  // ---------------------------------------------------------------- scoop
  scoop: {
    hopperCapacity: 200,          // kg
    rate: 70,                     // kg/s
    tickKg: 10,                   // kg per tick
    tickInterval: 0.143,          // s
    range: 3,                     // m from deposit centre
    maxSpeed: 2,                  // m/s, must be moving slower than this
  },

  // ---------------------------------------------------------------- deposits
  deposits: {
    normalCapacity: 400,          // kg
    richCapacity: 800,            // kg
    normalMinDist: 60,            // m from plant
    normalMaxDist: 100,
    richMinDist: 100,
    richMaxDist: 160,
    firstDepositDist: 15,         // m from rover start
    firstDepositCapacity: 600,    // kg — one full hopper plus a partial load completes a dome
    normalCount: 8,
    richCount: 4,
    moundRadius: 3.2,
    moundHeight: 1.1,
    sparkleInterval: 0.25,        // s between sparkle bursts
    sparkleCount: 2,
  },

  // ---------------------------------------------------------------- plant
  plant: {
    capacity: 600,                // kg feedstock held
    dumpKg: 200,                  // kg per dump
    dumpTime: 4,                  // s
    range: 4,                     // m
    position: { x: 0, z: 28 },
  },

  // ---------------------------------------------------------------- printer
  printer: {
    position: { x: 0, z: 60 },
    railLength: 40,               // m, five pads in a line
    padCount: 5,
    moduleFeedstockFirst: 200,    // kg deducted at print start (first module)
    moduleFeedstockLater: 300,    // kg deducted at print start (subsequent modules)
    feedstockCost: 300,           // kg deducted at print start (legacy alias)
    printTimeFirst: 12,           // s (first module)
    printTime: 18,                // s (subsequent modules)
    moduleTypes: ['dome', 'solar', 'life'],
    moduleLabels: { dome: 'DOME', solar: 'SOLAR', life: 'LIFE SUPPORT' },
  },

  // ---------------------------------------------------------------- modules
  modules: {
    domeShelterRadius: 2.5,       // m, rover centre inside = sheltered
    domeIntegrityBonus: 15,
    solarRecharge: 2,             // per second per solar module
    independencePerModule: 20,
    firstCompleteFlashMs: 260,    // white flash on the first completed module
    firstCompleteFloatText: '+20% INDEPENDENCE',
    firstCompleteEarthDim: 0.85,  // extra Earth sprite scale factor on the first module
  },

  // ---------------------------------------------------------------- combo
  combo: {
    window: 8,                    // s between clean scoop cycles
    max: 4,
    feedstockBonusPerStep: 0.25,  // 1 + 0.25 * (combo - 1)
  },

  // ---------------------------------------------------------------- hazards
  hazards: {
    firstShowerTime: 55,          // s — tutorial window before the first swarm
    showerMinInterval: 35,        // s — early cadence (before denseAfter)
    showerMaxInterval: 45,
    denseAfter: 120,
    denseMinInterval: 18,
    denseMaxInterval: 28,
    meteorsMin: 2,                // early shower size
    meteorsMax: 4,
    denseMeteorsMin: 3,           // shower size once denseAfter is reached
    denseMeteorsMax: 6,
    showerSpread: 4,              // s over which meteors spawn
    telegraph: 1.5,               // s
    targetRadius: 40,             // m around rover at spawn
    earlyInnerRadius: 1.5,        // m heavy damage radius during the tutorial window
    outerRadius: 8,               // m damage radius
    innerRadius: 2,               // m heavy damage radius
    earlyTargetMinOffset: 15,     // m — first shower rings stay clear of the rover
    impactShake: 0.6,
    impactShakeDuration: 0.4,
    flareTimes: [90, 165],
    flareDuration: 20,            // s
    flarePowerDrain: 5,           // per second exposed
    flareIntegrityDrain: 1,       // per second exposed
    flareShadowFactor: 0.5,       // exposure halved in shadow
    flareBloom: 1.6,
    flareFlashMs: 400,
  },

  // ---------------------------------------------------------------- resupply
  resupplyTime: 100,              // s
  resupply: {
    power: 50,
    feedstock: 150,
    independenceCost: 8,
    triggerRadius: 4,             // m
    descentTime: 3,              // s
    offset: { x: 18, z: 12 },     // from plant
  },

  // ---------------------------------------------------------------- world
  world: {
    size: 250,                    // m basin
    segments: 256,
    seed: 7,
    hills: 4,
    craters: 90,
    craterMin: 3,
    craterMax: 40,
    freshFraction: 0.25,
    rimHeight: 40,
    rimStart: 0.82,
    rocksCount: 900,
    rockMin: 0.12,
    rockMax: 2.4,
    flatRadius: 22,
    playRadius: 125,
    // foreground relief around the playfield
    nearCraterAmp: 1.6,           // displacement amplitude multiplier in the 0–80 m band
    nearCraterCount: 6,           // small craters stamped within 40 m of rover start
    nearCraterMinRadius: 3,
    nearCraterMaxRadius: 9,
    nearCraterMinDist: 8,
    nearCraterMaxDist: 38,
    nearCraterDepthFactor: 0.22,
    nearCraterRimFactor: 0.35,
    extraBoulderCount: 20,        // additional boulders inside the 60 m play radius
    extraBoulderMinDist: 6,
    extraBoulderMaxDist: 60,
    extraBoulderMin: 0.3,
    extraBoulderMax: 1.6,
    regolithDetailScale: 7.3,     // second detail layer UV scale (breaks visible tiling)
    regolithRepeat: 300,
    regolithDetailRepeat: 300,
    sunAzimuth: 115,              // degrees, fixed
    sunElevationStart: 12,        // degrees at t = 0
    sunElevationEnd: 4,           // degrees at t = runLength
    sunIntensity: 3.0,
    ambientIntensity: 0.15,
    earthAzimuth: 265,
    earthElevation: 24,
    earthSize: 5,                 // degrees
    earthDimAfterModule: 0.85,    // sprite scale factor per completed module
    stars: 7000,
    earthshine: 0.1,
    exposure: 1.0,
    shadowBias: -0.0005,
    shadowRadius: 2,
    shadowRayLength: 60,          // m
    shadowRayStep: 2,             // m
    craterScarRadius: 4,
    maxCraters: 12,
    bloomThreshold: 0.85,
    bloomStrength: 0.35,
    bloomRadius: 0.6,
    // distant crater-rim mountain ring (silhouette at the horizon)
    mountainRingRadius: 400,      // m
    mountainRingHeight: 5,        // m above the basin floor
    mountainRingSegments: 96,
    mountainRingJitter: 0.35,     // 0..1 height variation
  },

  // ---------------------------------------------------------------- camera
  camera: {
    offset: [0, 4, -9],           // behind and above (rover forward is -Z)
    lookAt: [0, 1, 4],
    stiffness: 6,
    printPullBack: 3,             // extra metres back while printing
    printPullBackStiffness: 2,
    shakeIntensity: 0.4,
    shakeDuration: 0.3,
    fov: 60,
  },

  // ---------------------------------------------------------------- stages
  tutorialStages: [
    { time: 0, text: 'Hold SPACE beside a deposit to scoop regolith.' },
    { time: 8, text: 'Drive to the sintering plant to make feedstock.' },
    { time: 16, text: 'Press ENTER to send the printer after a module.' },
  ],

  // ---------------------------------------------------------------- strings
  banner: {
    printingDome: 'PRINTING DOME — 12 s',
    printingSolar: 'PRINTING SOLAR — 12 s',
    printingLife: 'PRINTING LIFE SUPPORT — 12 s',
    flare: 'SOLAR FLARE — SEEK SHADOW',
    meteor: 'METEOR SWARM',
    resupply: 'RESUPPLY INBOUND',
    moduleComplete: 'MODULE COMPLETE',
    lowPower: 'POWER CRITICAL',
  },

  toast: {
    scoop: 'Scoop engaged — regolith inbound.',
    plant: 'Feedstock ready — printer standing by.',
    print: 'Printing module — keep the feedstock coming.',
    noFeedstock: 'Need 200 kg feedstock at the plant.',
    printBusy: 'Printer busy — one job at a time.',
    noPads: 'All pads occupied.',
    resupply: 'Earth resupply taken — independence −8%.',
    boulder: 'Boulder strike — combo reset.',
    meteor: 'Micrometeoroid impact.',
    flare: 'Solar flare — seek shadow.',
    lowPower: 'Power critical — get into sunlight.',
    sheltered: 'Sheltered in dome.',
    depositEmpty: 'Deposit depleted.',
  },

  label: {
    independence: 'INDEPENDENCE',
    timer: 'T−',
    power: 'POWER',
    integrity: 'INTEGRITY',
    hopper: 'HOPPER',
    feedstock: 'FEEDSTOCK',
    combo: 'COMBO',
    module: 'MODULE',
    score: 'Score',
    best: 'Best',
    independenceScore: 'Independence',
    timeBonus: 'Time bonus',
    modulesBuilt: 'Modules built',
    timeLeft: 'Time left',
    cause: 'Cause',
  },

  endCause: {
    integrity: 'Base integrity lost.',
    power: 'Base power lost.',
    time: 'Surface window closed.',
  },

  // ---------------------------------------------------------------- audio
  // All values finite; filter types are valid BiquadFilterType strings.
  audio: {
    musicVolume: 0.35,
    musicFade: 1.5,
    voiceVolume: 0.9,
    voiceMusicDuck: 0.5,
    sfxVolume: 0.8,
    ambience: {
      filterType: 'lowpass',      // valid BiquadFilterType
      filterFreq: 220,            // Hz
      filterQ: 0.7,
      volume: 0.12,
      flareVolume: 0.22,
      flareFilterFreq: 420,
      printingVolume: 0.10,
      printingFilterFreq: 900,
      engineVolume: 0.16,
      engineFilterFreq: 180,
      engineIdleVolume: 0.05,
      engineIdleFilterFreq: 120,
      tickVolume: 0.25,
      tickFreq: 880,
      tickDur: 0.08,
    },
  },

  // ---------------------------------------------------------------- assets
  assets: {
    textures: {
      regolith: 'tex_regolith',
      regolithNormal: 'tex_regolith_normal',
      regolithRough: 'tex_regolith_rough',
      rock: 'tex_rock',
      rockNormal: 'tex_rock_normal',
      rockRough: 'tex_rock_rough',
      metal: 'tex_metal',
      metalNormal: 'tex_metal_normal',
      metalRough: 'tex_metal_rough',
      ceramic: 'tex_ceramic',
      ceramicNormal: 'tex_ceramic_normal',
      ceramicRough: 'tex_ceramic_rough',
    },
    materials: {
      rover: 'tex_metal',
      roverMetalNormal: 'tex_metal_normal',
      roverMetalRoughness: 'tex_metal_rough',
      printer: 'tex_metal',
      ceramic: 'tex_ceramic',
      rock: 'tex_rock',
      regolith: 'tex_regolith',
      regolithNormal: 'tex_regolith_normal',
      regolithRoughness: 'tex_regolith_rough',
    },
    env: {
      earthSprite: 'spr_earth',
      landerSprite: 'spr_lander',
    },
    screens: {
      keyArt: 'key_art',
    },
    videos: {
      intro: 'intro',
      victory: 'victory',
      game_over: 'gameover',
    },
    audio: {
      music_main: 'music_main',
      ambience: null,
      voice: {
        vo_start: 'vo_start',
        vo_scoop: 'vo_scoop',
        vo_feedstock: 'vo_feedstock',
        vo_print: 'vo_print',
        vo_meteor: 'vo_meteor',
        vo_flare: 'vo_flare',
        vo_resupply: 'vo_resupply',
        vo_lowpower: 'vo_lowpower',
        vo_win: 'vo_win',
        vo_fail: 'vo_fail',
        vo_module_complete: 'vo_win',
      },
      sfx: {
        engine: 'engine',
        scoop: 'thud',
        dump: 'thud',
        feedstock: 'powerup',
        print: 'laser',
        tick: 'tick',
        impact: 'explosion',
        alarm: 'alarm',
        complete: 'success',
        resupply: 'coin',
        lander: 'whoosh',
        boulder: 'thud',
        hurt: 'hurt',
        click: 'click',
      },
    },
  },

  // ---------------------------------------------------------------- colours
  colors: {
    accent: '#ffb347',
    warning: '#ff3b30',
    earth: '#4a86c8',
    amber: '#d97a2b',
    dust: '#9a948c',
    regolith: '#8b8a84',
    shadow: '#0a0a0d',
    sun: '#fff2d8',
    deep: '#1b2a3d',
    hazard: '#ff7a1a',
    hopperFill: '#7fd6ff',
    mastAmber: '#ffb347',
    mastRed: '#ff3b30',
  },

  // ---------------------------------------------------------------- physics
  gravity: 1.62,                  // m/s^2, lunar
});

export { CONFIG };

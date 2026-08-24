import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Chart from "chart.js/auto";

// ============================================================
// SIMULATION CONSTANTS & STATE
// ============================================================

const ROAD_LENGTH = 640;
const ROAD_WIDTH = 68;
const SIDEWALK_WIDTH = 18;
const INTERSECTION_CLEARANCE = 72;
const swOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2; // 43
const STOP_DISTANCE = 46;

// Precise lane centerline offsets (Lane width = 17m each)
const LANE_1_OFFSET = 8.5;  // Inner Lane (Left-Turn & Through)
const LANE_2_OFFSET = 25.5; // Outer Lane (Right-Turn & Through)
const LANE_DIVIDER_OFFSET = 17.0; // Lane divider line between Lane 1 & Lane 2

const state = {
    isRunning: true,
    simSpeed: 1.0,
    timeElapsed: 0.0,
    theme: "dark",   // 'dark', 'light'
    selectedVehicle: null,
    passedVehiclesCount: 0,
    fps: 60,

    // Signal State Machine:
    // Approaches order: 0: 'N' (NB), 1: 'E' (EB), 2: 'S' (SB), 3: 'W' (WB)
    currentPhaseIdx: 0,
    subPhase: "green", // 'green', 'yellow', 'all_red'
    phaseElapsed: 0.0,
    allocatedGreen: 20.0,
    yellowDuration: 3.0,
    allRedDuration: 2.0,

    // Formula & Flow parameters
    inflowRates: { N: 15, E: 15, S: 15, W: 15 },
    outflowRates: { N: 20, E: 20, S: 20, W: 20 },
    formulaParams: { alpha: 1.0, gamma: 1.5, gmin: 20, gmax: 120 },
    preCalculatedGreens: { N: 20, E: 20, S: 20, W: 20 },

    // Emergency Preemption & FCFS Ambulance Dispatch Queue
    emergencyMode: false,
    preemptionActive: false,
    preemptionApproach: "N",
    dispatchPhase: "idle", // 'idle', 'en_route', 'clearing_switch', 'cleared'
    ambulanceQueue: [],    // FCFS FIFO Queue of active ambulances: [{ id, seq, vehicle, approach, spawnTime, hasCleared }]
    fcfsTransitionTimer: 0.0, // Safety All-Red clearance timer during FCFS switch between approaches

    // Saved Pre-Emergency Signal State (Restores green back to the side that had green before ambulance)
    savedPreEmergencyState: null,
    isRestoringPostEmergency: false,

    // Virtual Backlog Queue (counts vehicles when visual road is full for accurate formula calculation)
    virtualBacklog: { N: [], E: [], S: [], W: [] }
};

const approachKeys = ["N", "E", "S", "W"];
const approachNames = { N: "NORTH (NB)", E: "EAST (EB)", S: "SOUTH (SB)", W: "WEST (WB)" };

// ============================================================
// BASELINE MATHEMATICAL SIGNAL CONTROLLER
// ============================================================

class SignalControllers {
    static calculateBaselineFormulaG(dirKey, dirMetrics, params) {
        const Q = dirMetrics ? (dirMetrics.queue || 0) : 0;
        const Wt = dirMetrics ? ((dirMetrics.bikes || 0) + 2 * (dirMetrics.cars || 0) + 4 * (dirMetrics.trucks || 0)) : 0;

        const lmd_in = state.inflowRates[dirKey] !== undefined ? state.inflowRates[dirKey] : 15;
        const s_out = state.outflowRates[dirKey] !== undefined ? state.outflowRates[dirKey] : 20;

        const s_out_sec = Math.max(0.1, s_out / 60.0);
        const l_d = Wt / Math.max(1.0, s_out);
        const r_d = lmd_in / Math.max(1.0, s_out);

        const alpha = params.alpha || 1.0;
        const gamma = params.gamma || 1.5;
        const gmin = params.gmin || 20;
        const gmax = params.gmax || 120;

        const termFlow = 1.0 + (gamma * r_d);
        const termQueue = alpha * (Q / Math.max(0.1, s_out_sec * 5.0));
        const rawG = gmin + l_d + (termQueue * termFlow);

        const calculatedG = Math.max(gmin, Math.min(Math.round(rawG), gmax));

        return {
            G: calculatedG,
            Q: Q,
            Wt: Wt,
            l: l_d,
            r: r_d,
            inflow: lmd_in,
            outflow: s_out
        };
    }
}

// ============================================================
// THREE.JS SCENE & CAMERA SETUP
// ============================================================

const container = document.getElementById("scene-container");
const canvasWrapper = document.querySelector(".canvas-wrapper");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.0008);

const viewSize = 360;
const aspect = (canvasWrapper.clientWidth || 600) / (canvasWrapper.clientHeight || 520);

const camera = new THREE.OrthographicCamera(
    -viewSize * aspect,
    viewSize * aspect,
    viewSize,
    -viewSize,
    0.1,
    4000
);
camera.position.set(280, 340, 280);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvasWrapper.clientWidth || 600, canvasWrapper.clientHeight || 520);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.minZoom = 0.45;
controls.maxZoom = 2.4;
controls.maxPolarAngle = Math.PI / 2.05;
controls.update();

// Lights
const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x22262c, 2.2);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
sunLight.position.set(-220, 360, 180);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -380;
sunLight.shadow.camera.right = 380;
sunLight.shadow.camera.top = 380;
sunLight.shadow.camera.bottom = -380;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 1000;
sunLight.shadow.bias = -0.0004;
scene.add(sunLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambientLight);

const nightMaterials = [];

// ============================================================
// MATERIALS & PROCEDURAL WORLD (MINIMALIST MONOCHROME)
// ============================================================

const materials = {
    ground: new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.98 }),
    road: new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.92 }),
    roadDark: new THREE.MeshStandardMaterial({ color: 0x0c0e11, roughness: 0.9 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.9 }),
    curb: new THREE.MeshStandardMaterial({ color: 0x4f555d, roughness: 0.92 }),
    whiteStripe: new THREE.MeshStandardMaterial({ color: 0xC5C6C7, roughness: 0.6 }),
    yellowStripe: new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.6 }),
    emergencyRed: new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x73787C, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 }),
    glassWarm: new THREE.MeshStandardMaterial({ color: 0xC5C6C7, roughness: 0.2, emissive: 0x000000 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x73787C, roughness: 0.88 }),
    concreteDark: new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.85 }),
    brickRed: new THREE.MeshStandardMaterial({ color: 0x3e434a, roughness: 0.92 }),
    ambulanceWhite: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }),
    villaWhite: new THREE.MeshStandardMaterial({ color: 0xC5C6C7, roughness: 0.75 }),
    roofSlate: new THREE.MeshStandardMaterial({ color: 0x121519, roughness: 0.85 }),
    roofFlat: new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.9 }),
    woodDark: new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.85 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.5, metalness: 0.8 }),
    metalChrome: new THREE.MeshStandardMaterial({ color: 0xC5C6C7, roughness: 0.2, metalness: 0.9 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x000000, roughness: 0.2 }),
    redNeon: new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x000000 }),
    greenNeon: new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x000000 }),
    blueNeon: new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x000000 }),
    amberNeon: new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0x000000 })
};

function addBox(w, h, d, material, x, y, z, parent = scene, castShadow = true, receiveShadow = true) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
}

function addCylinder(rt, rb, h, segs, material, x, y, z, parent = scene) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, segs);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}

// Ground & Roads
addBox(1200, 2, 1200, materials.ground, 0, -1, 0);
addBox(ROAD_LENGTH, 1, ROAD_WIDTH, materials.road, 0, 0, 0);
addBox(ROAD_WIDTH, 1.02, ROAD_LENGTH, materials.road, 0, 0.01, 0);

// Sidewalks
const pathLenX = (ROAD_LENGTH - INTERSECTION_CLEARANCE) / 2;
const pathLenZ = (ROAD_LENGTH - INTERSECTION_CLEARANCE) / 2;
const swPositions = [
    { w: pathLenX, d: SIDEWALK_WIDTH, x: -(INTERSECTION_CLEARANCE / 2 + pathLenX / 2), z: swOffset },
    { w: pathLenX, d: SIDEWALK_WIDTH, x: (INTERSECTION_CLEARANCE / 2 + pathLenX / 2), z: swOffset },
    { w: 100, d: SIDEWALK_WIDTH, x: -90, z: -swOffset },
    { w: 90, d: SIDEWALK_WIDTH, x: -265, z: -swOffset },
    { w: pathLenX, d: SIDEWALK_WIDTH, x: (INTERSECTION_CLEARANCE / 2 + pathLenX / 2), z: -swOffset },
    { w: SIDEWALK_WIDTH, d: pathLenZ, x: -swOffset, z: -(INTERSECTION_CLEARANCE / 2 + pathLenZ / 2) },
    { w: SIDEWALK_WIDTH, d: pathLenZ, x: -swOffset, z: (INTERSECTION_CLEARANCE / 2 + pathLenZ / 2) },
    { w: SIDEWALK_WIDTH, d: pathLenZ, x: swOffset, z: -(INTERSECTION_CLEARANCE / 2 + pathLenZ / 2) },
    { w: SIDEWALK_WIDTH, d: pathLenZ, x: swOffset, z: (INTERSECTION_CLEARANCE / 2 + pathLenZ / 2) }
];
swPositions.forEach(p => addBox(p.w, 2.2, p.d, materials.sidewalk, p.x, 1.1, p.z));

const cornerOffset = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2;
[[-cornerOffset, -cornerOffset], [cornerOffset, -cornerOffset], [-cornerOffset, cornerOffset], [cornerOffset, cornerOffset]].forEach(([cx, cz]) => {
    addBox(SIDEWALK_WIDTH, 2.2, SIDEWALK_WIDTH, materials.sidewalk, cx, 1.1, cz);
});

// Hospital Driveway & Canopy
function buildAmbulanceEntrancePath() {
    const group = new THREE.Group();
    addBox(36, 0.6, 120, materials.roadDark, -192, 0.3, -94, group);
    addBox(2.0, 1.2, 116, materials.curb, -173, 0.6, -96, group);
    addBox(2.0, 1.2, 116, materials.curb, -211, 0.6, -96, group);
    addBox(30, 0.1, 40, materials.emergencyRed, -192, 0.62, -125, group, false, false);

    for (let hz = -140; hz <= -105; hz += 7) {
        addBox(26, 0.12, 1.4, materials.yellowStripe, -192, 0.64, hz, group, false, false);
    }
    const beacon = addBox(1.5, 1.5, 1.5, materials.redNeon, -170, 17, -42, group, false, false);
    nightMaterials.push({ mesh: beacon, baseEmissive: 0xff0000, nightEmissive: 0xff0000, nightIntensity: 3.0 });
    scene.add(group);
}
buildAmbulanceEntrancePath();

// Double Yellow Centerlines & White Dashed Lane Dividers
for (let x = -300; x <= 300; x += 18) {
    if (Math.abs(x) < 50) continue;
    addBox(9, 0.08, 0.8, materials.yellowStripe, x, 0.55, -0.6, scene, false, false);
    addBox(9, 0.08, 0.8, materials.yellowStripe, x, 0.55, 0.6, scene, false, false);
}
for (let z = -250; z <= 250; z += 18) {
    if (Math.abs(z) < 50) continue;
    addBox(0.8, 0.08, 9, materials.yellowStripe, -0.6, 0.55, z, scene, false, false);
    addBox(0.8, 0.08, 9, materials.yellowStripe, 0.6, 0.55, z, scene, false, false);
}

for (let x = -300; x <= 300; x += 16) {
    if (Math.abs(x) < 48) continue;
    addBox(8, 0.08, 0.6, materials.whiteStripe, x, 0.55, LANE_DIVIDER_OFFSET, scene, false, false);
    addBox(8, 0.08, 0.6, materials.whiteStripe, x, 0.55, -LANE_DIVIDER_OFFSET, scene, false, false);
}
for (let z = -250; z <= 250; z += 16) {
    if (Math.abs(z) < 48) continue;
    addBox(0.6, 0.08, 8, materials.whiteStripe, LANE_DIVIDER_OFFSET, 0.55, z, scene, false, false);
    addBox(0.6, 0.08, 8, materials.whiteStripe, -LANE_DIVIDER_OFFSET, 0.55, z, scene, false, false);
}

// Stop lines
addBox(ROAD_WIDTH / 2, 0.1, 2.0, materials.whiteStripe, ROAD_WIDTH / 4, 0.58, STOP_DISTANCE, scene, false, false); // NB
addBox(ROAD_WIDTH / 2, 0.1, 2.0, materials.whiteStripe, -ROAD_WIDTH / 4, 0.58, -STOP_DISTANCE, scene, false, false); // SB
addBox(2.0, 0.1, ROAD_WIDTH / 2, materials.whiteStripe, -STOP_DISTANCE, 0.58, ROAD_WIDTH / 4, scene, false, false); // EB
addBox(2.0, 0.1, ROAD_WIDTH / 2, materials.whiteStripe, STOP_DISTANCE, 0.58, -ROAD_WIDTH / 4, scene, false, false); // WB

// Zebra Crossings
for (let z = -30; z <= 30; z += 5) {
    addBox(3.0, 0.06, 2.4, materials.whiteStripe, -40, 0.56, z, scene, false, false);
    addBox(3.0, 0.06, 2.4, materials.whiteStripe, 40, 0.56, z, scene, false, false);
}
for (let x = -30; x <= 30; x += 5) {
    addBox(2.4, 0.06, 3.0, materials.whiteStripe, x, 0.56, -40, scene, false, false);
    addBox(2.4, 0.06, 3.0, materials.whiteStripe, x, 0.56, 40, scene, false, false);
}

// ============================================================
// 3D ROAD SURFACE ORIENTATION DECALS (ALIGNED WITH 3D WORLD)
// ============================================================

function createRoadDirectionLabel(text, x, z, rotY) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);

    // Clean dark container with charcoal border and silver text
    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    if (ctx.roundRect) {
        ctx.roundRect(10, 10, 492, 108, 24);
    } else {
        ctx.fillRect(10, 10, 492, 108);
    }
    ctx.fill();
    ctx.strokeStyle = "#73787C";
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.font = "bold 44px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#C5C6C7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(42, 10.5);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.65, z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rotY;
    scene.add(mesh);
    return mesh;
}

// Crisp 3D Asphalt Decals on each approach end
createRoadDirectionLabel("▲ NORTH (NB)", 0, 240, Math.PI);
createRoadDirectionLabel("▼ SOUTH (SB)", 0, -240, 0);
createRoadDirectionLabel("▶ EAST (EB)", -240, 0, Math.PI / 2);
createRoadDirectionLabel("◀ WEST (WB)", 240, 0, -Math.PI / 2);

// 3D Buildings
function buildCity() {
    // Hospital
    const hosp = new THREE.Group();
    hosp.position.set(-180, 2.2, -160);
    addBox(240, 1.2, 190, materials.concrete, 0, 0.6, 0, hosp);
    addBox(76, 68, 54, materials.villaWhite, 25, 34, 25, hosp);
    addBox(78, 2.0, 56, materials.roofFlat, 25, 69, 25, hosp);
    for (let f = 12; f <= 58; f += 10) {
        const win = addBox(68, 5.5, 55, materials.glassWarm, 25, f, 25, hosp, false, false);
        nightMaterials.push({ mesh: win, baseEmissive: 0x000000, nightEmissive: 0x93c5fd, nightIntensity: 0.9 });
    }
    const crossV = addBox(3.0, 12.0, 1.2, materials.redNeon, 25, 48, 52.5, hosp, false, false);
    const crossH = addBox(12.0, 3.0, 1.2, materials.redNeon, 25, 48, 52.5, hosp, false, false);
    nightMaterials.push({ mesh: crossV, baseEmissive: 0xef4444, nightEmissive: 0xef4444, nightIntensity: 2.8 });
    nightMaterials.push({ mesh: crossH, baseEmissive: 0xef4444, nightEmissive: 0xef4444, nightIntensity: 2.8 });

    // ER Canopy
    addBox(32, 18, 28, materials.villaWhite, -12, 9, 45, hosp);
    const erCanopy = addBox(34, 2.2, 26, materials.redNeon, -12, 14, 37, hosp, false, false);
    nightMaterials.push({ mesh: erCanopy, baseEmissive: 0xef4444, nightEmissive: 0xef4444, nightIntensity: 2.2 });
    scene.add(hosp);

    // Towers
    const towerDist = new THREE.Group();
    towerDist.position.set(180, 2.2, -160);
    addBox(240, 1.2, 190, materials.concrete, 0, 0.6, 0, towerDist);
    addBox(54, 160, 50, materials.concreteDark, -50, 80, 20, towerDist);
    for (let f = 10; f < 155; f += 9) {
        const win = addBox(55, 6.5, 51, materials.glassWarm, -50, f, 20, towerDist, false, false);
        nightMaterials.push({ mesh: win, baseEmissive: 0x000000, nightEmissive: 0x93c5fd, nightIntensity: 0.9 });
    }
    addBox(52, 75, 50, materials.concrete, 55, 37.5, 25, towerDist);
    addBox(60, 48, 44, materials.brickRed, 5, 24, -50, towerDist);
    scene.add(towerDist);

    // Police & Fire
    const pol = new THREE.Group();
    pol.position.set(-180, 2.2, 160);
    addBox(240, 1.2, 190, materials.concrete, 0, 0.6, 0, pol);
    addBox(66, 36, 48, materials.concreteDark, -30, 18, 25, pol);
    scene.add(pol);

    const fire = new THREE.Group();
    fire.position.set(180, 2.2, 160);
    addBox(240, 1.2, 190, materials.concrete, 0, 0.6, 0, fire);
    addBox(72, 34, 48, materials.brickRed, 20, 17, 25, fire);
    scene.add(fire);
}
buildCity();

// Trees & Street Lamps
function createTree(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 2.2, z);
    addCylinder(0.8, 1.3, 7, 8, materials.woodDark, 0, 3.5, 0, group);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.9 });
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(5.8, 8, 8), leafMat);
    s1.position.set(0, 9.5, 0);
    s1.castShadow = true;
    group.add(s1);
    scene.add(group);
}
[[-140, -110], [120, -100], [-130, 120], [130, 120]].forEach(([x, z]) => createTree(x, z));

const streetLights = [];
function createStreetLamp(x, z, rotY = 0) {
    const group = new THREE.Group();
    group.position.set(x, 2.2, z);
    group.rotation.y = rotY;
    addCylinder(0.6, 0.8, 26, 8, materials.metalDark, 0, 13, 0, group);
    addBox(8, 0.5, 0.5, materials.metalDark, 4, 25.5, 0, group);
    const bulb = addBox(2.2, 0.3, 1.2, materials.lampGlow, 7.5, 24.7, 0, group, false, false);
    const light = new THREE.PointLight(0xffe8aa, 0, 90, 1.8);
    light.position.set(7.5, 24, 0);
    group.add(light);
    scene.add(group);
    streetLights.push({ bulb, light });
}
[-200, -90, 90, 200].forEach(x => {
    createStreetLamp(x, swOffset + 5, 0);
    createStreetLamp(x, -swOffset - 5, Math.PI);
});

// ============================================================
// 3D TRAFFIC LIGHT SIGNAL HEADS
// ============================================================

function createCountdownCanvasTexture(text = "30", color = "#22c55e") {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 128, 128);
    ctx.font = "bold 76px 'JetBrains Mono', monospace";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

const laneSignalHeads = [];

function buildTrafficSignalPole(x, z, rotY, approach) {
    const group = new THREE.Group();
    group.position.set(x, 2.2, z);
    group.rotation.y = rotY;

    // Pole & Mast arm
    addCylinder(0.9, 1.2, 28, 8, materials.metalDark, 0, 14, 0, group);
    addBox(24, 0.8, 0.8, materials.metalDark, 12, 27, 0, group);

    // Signal Head
    const headGroup = new THREE.Group();
    headGroup.position.set(16, 26, 0);
    addBox(5.0, 14.0, 3.5, materials.metalDark, 0, 0, 0, headGroup);

    const redMat = new THREE.MeshStandardMaterial({ color: 0x220505, emissive: 0x000000 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0x221a05, emissive: 0x000000 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x05220c, emissive: 0x000000 });

    addCylinder(1.4, 1.4, 0.8, 12, redMat, 0, 4.2, 1.8, headGroup);
    addCylinder(1.4, 1.4, 0.8, 12, yellowMat, 0, 0, 1.8, headGroup);
    addCylinder(1.4, 1.4, 0.8, 12, greenMat, 0, -4.2, 1.8, headGroup);

    // 3D Timer Screen on side
    const timerMat = new THREE.MeshBasicMaterial({ map: createCountdownCanvasTexture("20", "#22c55e") });
    addBox(6.5, 6.5, 0.5, timerMat, 0, 10.5, 0.2, headGroup);

    group.add(headGroup);
    scene.add(group);

    laneSignalHeads.push({
        approach: approach,
        head: { redMat, yellowMat, greenMat, timerMat }
    });
}

// 4 Poles for 4 Approaches
buildTrafficSignalPole(swOffset + 4, STOP_DISTANCE + 4, Math.PI, "N");        // North (NB)
buildTrafficSignalPole(-STOP_DISTANCE - 4, swOffset + 4, -Math.PI / 2, "E");  // East (EB)
buildTrafficSignalPole(-swOffset - 4, -STOP_DISTANCE - 4, 0, "S");           // South (SB)
buildTrafficSignalPole(STOP_DISTANCE + 4, -swOffset - 4, Math.PI / 2, "W");   // West (WB)

// ============================================================
// 3D VEHICLE MESH BUILDER
// ============================================================

const vehicleColors = [0xC5C6C7, 0x73787C, 0x1f242c, 0x475569, 0xf8fafc, 0x2b3038, 0xd1d5db, 0x111317];

function createWheelMesh() {
    const group = new THREE.Group();
    const tire = addCylinder(1.6, 1.6, 1.1, 10, materials.metalDark, 0, 0, 0, group);
    tire.rotation.z = Math.PI / 2;
    const cap = addCylinder(0.9, 0.9, 1.2, 8, materials.metalChrome, 0, 0, 0, group);
    cap.rotation.z = Math.PI / 2;
    return group;
}

function buildVehicleMesh(type = "car", colorHex = 0x2563eb) {
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.3 });
    const wheels = [];

    function attachWheel(wx, wy, wz) {
        const w = createWheelMesh();
        w.position.set(wx, wy, wz);
        root.add(w);
        wheels.push(w);
    }

    const blinkLeft = addBox(0.5, 0.6, 0.6, materials.amberNeon, 7.2, 2.5, 2.8, root, false, false);
    const blinkRight = addBox(0.5, 0.6, 0.6, materials.amberNeon, 7.2, 2.5, -2.8, root, false, false);

    if (type === "ambulance") {
        addBox(18.0, 6.6, 7.2, materials.ambulanceWhite, 0, 3.8, 0, root);
        addBox(18.2, 1.4, 7.3, materials.redNeon, 0, 3.4, 0, root, false, false);
        const sirenRed = addBox(1.8, 1.2, 3.0, materials.redNeon, 3.0, 7.6, -1.8, root, false, false);
        const sirenBlue = addBox(1.8, 1.2, 3.0, materials.blueNeon, 3.0, 7.6, 1.8, root, false, false);
        root.userData.sirens = [sirenRed, sirenBlue];
        attachWheel(5.2, 1.6, 3.6);
        attachWheel(5.2, 1.6, -3.6);
        attachWheel(-5.2, 1.6, 3.6);
        attachWheel(-5.2, 1.6, -3.6);
    } else if (type === "truck") {
        // Cargo truck / Bus
        addBox(24.0, 7.5, 7.5, materials.concrete, -2.0, 4.8, 0, root);
        addBox(7.0, 6.0, 7.2, bodyMat, 8.5, 4.0, 0, root);
        addBox(3.5, 3.0, 6.8, materials.glass, 8.5, 5.2, 0, root);
        attachWheel(8.5, 1.6, 3.8);
        attachWheel(8.5, 1.6, -3.8);
        attachWheel(-4.0, 1.6, 3.8);
        attachWheel(-4.0, 1.6, -3.8);
        attachWheel(-9.5, 1.6, 3.8);
        attachWheel(-9.5, 1.6, -3.8);
    } else if (type === "bike") {
        // Motorcycle / Bike
        addBox(8.0, 3.5, 2.0, bodyMat, 0, 2.5, 0, root);
        const riderHead = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 8), materials.metalDark);
        riderHead.position.set(-0.5, 5.5, 0);
        root.add(riderHead);
        attachWheel(3.2, 1.4, 0);
        attachWheel(-3.2, 1.4, 0);
    } else {
        // Sedan Car
        addBox(14.5, 3.2, 6.6, bodyMat, 0, 2.5, 0, root);
        addBox(8.0, 3.0, 6.0, bodyMat, -0.6, 5.4, 0, root);
        addBox(7.2, 2.4, 6.2, materials.glass, -0.6, 5.3, 0, root);
        attachWheel(4.2, 1.6, 3.4);
        attachWheel(4.2, 1.6, -3.4);
        attachWheel(-4.2, 1.6, 3.4);
        attachWheel(-4.2, 1.6, -3.4);
    }

    root.userData.blinkers = { blinkLeft, blinkRight };
    return { root, wheels };
}

// ============================================================
// 3D VEHICLE CLASS WITH CONTINUOUS TRAJECTORIES
// ============================================================

const vehicles = [];
let nextVehicleId = 1;
let nextAmbulanceSeq = 1;

class Vehicle3D {
    constructor(approach, lane = 1, route = "straight", type = "car", colorHex = null) {
        this.id = nextVehicleId++;
        this.approach = approach; // 'N', 'E', 'S', 'W'
        this.lane = lane;         // 1 (Inner lane: Straight / Left) or 2 (Outer lane: Straight / Right)
        this.route = route;       // 'straight', 'left', 'right', 'hospital'
        this.type = type;         // 'bike', 'car', 'truck', 'ambulance'
        this.colorHex = colorHex || vehicleColors[Math.floor(Math.random() * vehicleColors.length)];

        const built = buildVehicleMesh(this.type, this.colorHex);
        this.mesh = built.root;
        this.wheels = built.wheels;
        this.blinkers = built.root.userData.blinkers;
        this.mesh.userData.vehicle = this;

        this.isAmbulance = this.type === "ambulance";
        this.ambulanceIndex = this.isAmbulance ? nextAmbulanceSeq++ : 0;
        this.hasClearedSignal = false;
        this.weight = this.type === "bike" ? 1 : (this.type === "truck" || this.isAmbulance ? 4 : 2);
        this.length = this.type === "truck" ? 24 : (this.isAmbulance ? 18 : (this.type === "bike" ? 9 : 15));
        this.maxSpeed = this.isAmbulance ? 56 : (this.type === "bike" ? 48 : (this.type === "truck" ? 34 : 42));
        this.speed = this.maxSpeed * 0.9;
        this.waitTime = 0.0;
        this.isQueued = false;
        this.status = this.isAmbulance ? `Ambulance #${this.ambulanceIndex} En Route` : "Moving smoothly";

        this.phase = "approach";
        this.turnProgress = 0.0;
        this.sidewaysYieldOffset = 0.0;

        // Strict lane centerline offset (Lane 1 = 8.5m, Lane 2 = 25.5m)
        this.laneOffset = (this.lane === 1) ? LANE_1_OFFSET : LANE_2_OFFSET;
        this.initSpawnPosition();
        scene.add(this.mesh);
    }

    initSpawnPosition() {
        const spawnDist = 310;
        if (this.approach === "N") { // NB (coming from +z heading North / -z)
            this.mesh.position.set(this.laneOffset, 0.5, spawnDist);
            this.mesh.rotation.y = Math.PI / 2;
        } else if (this.approach === "E") { // EB (coming from -x heading East / +x)
            this.mesh.position.set(-spawnDist, 0.5, this.laneOffset);
            this.mesh.rotation.y = 0;
        } else if (this.approach === "S") { // SB (coming from -z heading South / +z)
            this.mesh.position.set(-this.laneOffset, 0.5, -spawnDist);
            this.mesh.rotation.y = -Math.PI / 2;
        } else if (this.approach === "W") { // WB (coming from +x heading West / -x)
            this.mesh.position.set(spawnDist, 0.5, -this.laneOffset);
            this.mesh.rotation.y = Math.PI;
        }
    }

    computeStopLineDistance() {
        if (this.phase !== "approach") return -999;
        const p = this.mesh.position;
        if (this.approach === "N") return p.z - STOP_DISTANCE;
        if (this.approach === "E") return -STOP_DISTANCE - p.x;
        if (this.approach === "S") return -STOP_DISTANCE - p.z;
        if (this.approach === "W") return p.x - STOP_DISTANCE;
        return -999;
    }

    canMove() {
        if (this.phase !== "approach") return true;
        if (state.emergencyMode) {
            // In All-Red safety transition between FCFS turns, all approaching vehicles hold
            if (state.fcfsTransitionTimer > 0) return false;
            // Only the side with active FCFS priority gets green corridor
            return this.approach === state.preemptionApproach;
        }
        const activeDir = approachKeys[state.currentPhaseIdx];
        if (this.approach === activeDir && state.subPhase === "green") return true;
        if (this.approach === activeDir && state.subPhase === "yellow") {
            return this.computeStopLineDistance() < 18; // Amber decision zone
        }
        return false;
    }

    signalApproachCleared() {
        if (this.hasClearedSignal) return;
        this.hasClearedSignal = true;
        handleAmbulanceSignalCleared(this);
    }

    update(dt) {
        let targetSpeed = this.maxSpeed;
        const outflowRate = state.outflowRates[this.approach] || 20;
        const outflowMultiplier = Math.max(0.5, Math.min(2.0, outflowRate / 20.0));
        targetSpeed *= outflowMultiplier;

        if (state.weather === "rain") targetSpeed *= 0.75;
        else if (state.weather === "fog") targetSpeed *= 0.85;

        // Emergency yield discipline: Only civilian Lane 2 vehicles pull slightly aside (+4.5m to shoulder)
        let sirenBehind = false;
        if (!this.isAmbulance && state.emergencyMode) {
            vehicles.forEach(other => {
                if (other.isAmbulance && other.approach === this.approach && other.phase === "approach") {
                    let ambPos = (this.approach === "N" || this.approach === "S") ? other.mesh.position.z : other.mesh.position.x;
                    let myPos = (this.approach === "N" || this.approach === "S") ? this.mesh.position.z : this.mesh.position.x;
                    if (this.approach === "N" && ambPos > myPos) sirenBehind = true;
                    if (this.approach === "S" && ambPos < myPos) sirenBehind = true;
                    if (this.approach === "E" && ambPos < myPos) sirenBehind = true;
                    if (this.approach === "W" && ambPos > myPos) sirenBehind = true;
                }
            });
        }

        if (sirenBehind && this.lane === 2) {
            this.sidewaysYieldOffset = THREE.MathUtils.lerp(this.sidewaysYieldOffset, 4.5, dt * 3);
            targetSpeed = Math.min(targetSpeed, 18);
            this.status = "🚨 Yielding to ambulance";
        } else {
            this.sidewaysYieldOffset = THREE.MathUtils.lerp(this.sidewaysYieldOffset, 0, dt * 2);
        }

        // Signal Obedience at Stop Line
        if (this.phase === "approach") {
            const distToStop = this.computeStopLineDistance();
            if (distToStop > 0 && distToStop < 90) {
                if (!this.canMove()) {
                    if (distToStop < 3.5) {
                        targetSpeed = 0;
                        this.status = "Stopped at Red Signal";
                    } else {
                        targetSpeed = Math.min(targetSpeed, this.maxSpeed * (distToStop / 90));
                        this.status = "Braking for Signal";
                    }
                }
            }
        }

        // Strict In-Lane Car-Following Headway (same approach AND same lane only)
        if (!this.isAmbulance) {
            vehicles.forEach(other => {
                if (other.id === this.id || other.approach !== this.approach || other.lane !== this.lane) return;
                // Only consider vehicles ahead that are still in approach phase
                if (other.phase !== "approach") return;

                let distAhead = 9999;
                if (this.approach === "N") distAhead = this.mesh.position.z - other.mesh.position.z;
                else if (this.approach === "E") distAhead = other.mesh.position.x - this.mesh.position.x;
                else if (this.approach === "S") distAhead = other.mesh.position.z - this.mesh.position.z;
                else if (this.approach === "W") distAhead = this.mesh.position.x - other.mesh.position.x;

                if (distAhead <= 0) return;

                const safeGap = (this.length / 2) + (other.length / 2) + 6.0;
                if (distAhead < safeGap) {
                    targetSpeed = 0;
                    this.status = `Queued in Lane ${this.lane}`;
                } else if (distAhead < safeGap + 35) {
                    const headwayRatio = (distAhead - safeGap) / 35.0;
                    targetSpeed = Math.min(targetSpeed, Math.max(6, other.speed) * headwayRatio);
                }
            });
        }

        // Smooth Acceleration & Deceleration
        if (this.speed < targetSpeed) {
            this.speed = Math.min(targetSpeed, this.speed + 25 * dt);
        } else {
            this.speed = Math.max(targetSpeed, this.speed - 40 * dt);
        }

        if (this.speed < 0.5 && this.phase === "approach" && this.computeStopLineDistance() < 90) {
            this.waitTime += dt;
            this.isQueued = true;
        } else {
            this.isQueued = false;
        }

        const moveStep = this.speed * dt;
        this.navigate(moveStep);

        // Realistic Wheel Rotation
        if (this.wheels) {
            const wheelRadius = 1.6;
            const rotDelta = (this.speed * dt) / wheelRadius;
            this.wheels.forEach(w => {
                w.rotation.x += rotDelta;
            });
        }

        // Turn Indicators / Blinkers
        if (this.blinkers) {
            const isTurning = this.phase.includes("turn") || (this.phase === "approach" && this.computeStopLineDistance() < 40 && this.route !== "straight");
            const blinkState = isTurning && Math.sin(Date.now() * 0.015) > 0;
            if (this.route === "left" || (this.isAmbulance && (this.approach === "N" || this.approach === "E"))) {
                this.blinkers.blinkLeft.material.emissiveIntensity = blinkState ? 2.8 : 0;
            } else if (this.route === "right" || (this.isAmbulance && (this.approach === "S" || this.phase.includes("driveway")))) {
                this.blinkers.blinkRight.material.emissiveIntensity = blinkState ? 2.8 : 0;
            }
        }

        // Siren Beacons
        if (this.mesh.userData.sirens) {
            const flash = Math.sin(Date.now() * 0.02) > 0;
            this.mesh.userData.sirens[0].material.emissiveIntensity = flash ? 3.8 : 0.1;
            this.mesh.userData.sirens[1].material.emissiveIntensity = !flash ? 3.8 : 0.1;
        }
    }

    navigate(step) {
        const p = this.mesh.position;
        const currentLaneOffset = this.laneOffset + this.sidewaysYieldOffset;

        // ============================================================
        // 🚑 EMERGENCY AMBULANCE PREEMPTION ROUTE (FCFS DISPATCH & HANDOFF)
        // ============================================================
        if (this.route === "hospital" && this.isAmbulance) {
            // Stage 1: Approach towards intersection or hospital entrance
            if (this.phase === "approach") {
                if (this.approach === "N") {
                    p.z -= step;
                    p.x = LANE_1_OFFSET;
                    this.mesh.rotation.y = Math.PI / 2;
                    // FCFS Signal approach cleared when crossing stop bar (z <= 46)
                    if (p.z <= STOP_DISTANCE) {
                        this.signalApproachCleared();
                    }
                    if (p.z <= 17) {
                        this.phase = "hospital_turn_nb_left";
                        this.turnProgress = 0;
                    }
                } else if (this.approach === "S") {
                    p.z += step;
                    p.x = -LANE_2_OFFSET;
                    this.mesh.rotation.y = -Math.PI / 2;
                    // FCFS Signal approach cleared when crossing stop bar (z >= -46)
                    if (p.z >= -STOP_DISTANCE) {
                        this.signalApproachCleared();
                    }
                    if (p.z >= -34) {
                        this.phase = "hospital_turn_sb_right";
                        this.turnProgress = 0;
                    }
                } else if (this.approach === "W") {
                    p.x -= step;
                    p.z = -LANE_2_OFFSET;
                    this.mesh.rotation.y = Math.PI;
                    // FCFS Signal approach cleared when crossing stop bar (x <= 46)
                    if (p.x <= STOP_DISTANCE) {
                        this.signalApproachCleared();
                    }
                    if (p.x <= -183.5) {
                        this.phase = "hospital_turn_driveway";
                        this.turnProgress = 0;
                    }
                } else if (this.approach === "E") {
                    p.x += step;
                    p.z = LANE_1_OFFSET;
                    this.mesh.rotation.y = 0;
                    // FCFS Signal approach cleared when initiating turn into hospital driveway (x >= -209)
                    if (p.x >= -209) {
                        this.signalApproachCleared();
                        this.phase = "hospital_turn_eb_to_er";
                        this.turnProgress = 0;
                    }
                }
                return;
            }

            // Stage 2A: NB left turn onto Westbound avenue
            if (this.phase === "hospital_turn_nb_left") {
                const R = 25.5;
                const arcLen = (Math.PI / 2) * R;
                this.turnProgress += step / arcLen;
                const angle = Math.min(this.turnProgress, 1.0) * (Math.PI / 2);
                p.x = -17 + R * Math.cos(angle);
                p.z = 17 - R * Math.sin(angle);
                this.mesh.rotation.y = Math.PI / 2 + angle;
                if (this.turnProgress >= 1.0) {
                    this.phase = "hospital_avenue";
                    p.x = -17;
                    p.z = -LANE_2_OFFSET;
                    this.mesh.rotation.y = Math.PI;
                }
                return;
            }

            // Stage 2B: SB right turn onto Westbound avenue
            if (this.phase === "hospital_turn_sb_right") {
                const R = 8.5;
                const arcLen = (Math.PI / 2) * R;
                this.turnProgress += step / arcLen;
                const angle = Math.min(this.turnProgress, 1.0) * (Math.PI / 2);
                p.x = -34 + R * Math.cos(angle);
                p.z = -34 + R * Math.sin(angle);
                this.mesh.rotation.y = -Math.PI / 2 - angle;
                if (this.turnProgress >= 1.0) {
                    this.phase = "hospital_avenue";
                    p.x = -34;
                    p.z = -LANE_2_OFFSET;
                    this.mesh.rotation.y = Math.PI;
                }
                return;
            }

            // Stage 2C: EB smooth turn into Hospital Driveway
            if (this.phase === "hospital_turn_eb_to_er") {
                const turnDist = 22.0;
                this.turnProgress += step / turnDist;
                const t = Math.min(this.turnProgress, 1.0);
                p.x = THREE.MathUtils.lerp(-209, -192, t);
                p.z = THREE.MathUtils.lerp(LANE_1_OFFSET, -34, t);
                this.mesh.rotation.y = THREE.MathUtils.lerp(0, Math.PI / 2, t);
                if (this.turnProgress >= 1.0) {
                    this.phase = "hospital_driveway";
                    p.x = -192;
                    p.z = -34;
                    this.mesh.rotation.y = Math.PI / 2;
                }
                return;
            }

            // Stage 3: Cruising along Westbound avenue towards Driveway (x = -183.5)
            if (this.phase === "hospital_avenue") {
                p.x -= step;
                p.z = -LANE_2_OFFSET;
                this.mesh.rotation.y = Math.PI;
                this.status = "En Route to Hospital ER Driveway";
                if (p.x <= -183.5) {
                    this.phase = "hospital_turn_driveway";
                    this.turnProgress = 0;
                }
                return;
            }

            // Stage 4: Turn right from avenue into Hospital Driveway
            if (this.phase === "hospital_turn_driveway") {
                const R = 8.5;
                const arcLen = (Math.PI / 2) * R;
                this.turnProgress += step / arcLen;
                const angle = Math.min(this.turnProgress, 1.0) * (Math.PI / 2);
                p.x = -183.5 - R * Math.sin(angle);
                p.z = -LANE_2_OFFSET - R * (1 - Math.cos(angle));
                this.mesh.rotation.y = Math.PI - angle;
                if (this.turnProgress >= 1.0) {
                    this.phase = "hospital_driveway";
                    p.x = -192;
                    p.z = -34;
                    this.mesh.rotation.y = Math.PI / 2;
                }
                return;
            }

            // Stage 5: Driving straight up Hospital Driveway to ER Canopy (z = -34 to -138)
            if (this.phase === "hospital_driveway") {
                p.x = -192;
                p.z -= step;
                this.mesh.rotation.y = Math.PI / 2;
                this.status = `Ambulance #${this.ambulanceIndex} Entering ER Bay`;
                const parkSlot = ((this.ambulanceIndex - 1) % 4);
                const targetZ = -138 + parkSlot * 16;
                if (p.z <= targetZ) {
                    p.z = targetZ;
                    this.phase = "hospital_arrived";
                    this.speed = 0;
                    this.status = `Ambulance #${this.ambulanceIndex} Parked at ER Bay (Bay ${parkSlot + 1})`;
                }
                return;
            }

            if (this.phase === "hospital_arrived") {
                this.speed = 0;
                const parkSlot = ((this.ambulanceIndex - 1) % 4);
                p.x = -192;
                p.z = -138 + parkSlot * 16;
                this.mesh.rotation.y = Math.PI / 2;
                this.status = `Ambulance #${this.ambulanceIndex} Parked at ER Bay (Bay ${parkSlot + 1})`;
                return;
            }
        }

        // ============================================================
        // 🚗 STANDARD VEHICLES STRICT CONTINUOUS MOTION & DISCIPLINED TURNS
        // ============================================================
        if (this.route === "straight") {
            if (this.approach === "N") { p.z -= step; p.x = currentLaneOffset; this.mesh.rotation.y = Math.PI / 2; }
            else if (this.approach === "E") { p.x += step; p.z = currentLaneOffset; this.mesh.rotation.y = 0; }
            else if (this.approach === "S") { p.z += step; p.x = -currentLaneOffset; this.mesh.rotation.y = -Math.PI / 2; }
            else if (this.approach === "W") { p.x -= step; p.z = -currentLaneOffset; this.mesh.rotation.y = Math.PI; }

            if (this.phase === "approach" && this.computeStopLineDistance() < -10) {
                this.phase = "departure";
            }
        } else if (this.route === "right" && this.lane === 2) {
            // Strict Lane 2 Right-Turn Arc (R = 8.5m from outer lane into outer lane)
            const R = 8.5;
            const arcLen = (Math.PI / 2) * R;

            if (this.phase === "approach") {
                if (this.approach === "N") {
                    p.z -= step; p.x = LANE_2_OFFSET; this.mesh.rotation.y = Math.PI / 2;
                    if (p.z <= 34) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "E") {
                    p.x += step; p.z = LANE_2_OFFSET; this.mesh.rotation.y = 0;
                    if (p.x >= -34) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "S") {
                    p.z += step; p.x = -LANE_2_OFFSET; this.mesh.rotation.y = -Math.PI / 2;
                    if (p.z >= -34) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "W") {
                    p.x -= step; p.z = -LANE_2_OFFSET; this.mesh.rotation.y = Math.PI;
                    if (p.x <= 34) { this.phase = "turning"; this.turnProgress = 0; }
                }
            } else if (this.phase === "turning") {
                this.turnProgress += step / arcLen;
                const angle = Math.min(this.turnProgress, 1.0) * (Math.PI / 2);

                if (this.approach === "N") {
                    p.x = 34 - R * Math.cos(angle);
                    p.z = 34 - R * Math.sin(angle);
                    this.mesh.rotation.y = Math.PI / 2 - angle;
                    if (this.turnProgress >= 1.0) { p.x = 34; p.z = LANE_2_OFFSET; this.phase = "departure"; }
                } else if (this.approach === "E") {
                    p.x = -34 + R * (1 - Math.cos(angle));
                    p.z = 25.5 + R * Math.sin(angle);
                    this.mesh.rotation.y = -angle;
                    if (this.turnProgress >= 1.0) { p.x = -LANE_2_OFFSET; p.z = 34; this.phase = "departure"; }
                } else if (this.approach === "S") {
                    p.x = -34 + R * Math.cos(angle);
                    p.z = -34 + R * Math.sin(angle);
                    this.mesh.rotation.y = -Math.PI / 2 - angle;
                    if (this.turnProgress >= 1.0) { p.x = -34; p.z = -LANE_2_OFFSET; this.phase = "departure"; }
                } else if (this.approach === "W") {
                    p.x = 34 - R * (1 - Math.cos(angle));
                    p.z = -25.5 - R * Math.sin(angle);
                    this.mesh.rotation.y = Math.PI - angle;
                    if (this.turnProgress >= 1.0) { p.x = LANE_2_OFFSET; p.z = -34; this.phase = "departure"; }
                }
            } else {
                // Strict Departure in receiving outer lane (offset 25.5)
                if (this.approach === "N") { p.x += step; p.z = LANE_2_OFFSET; this.mesh.rotation.y = 0; }
                else if (this.approach === "E") { p.z += step; p.x = -LANE_2_OFFSET; this.mesh.rotation.y = -Math.PI / 2; }
                else if (this.approach === "S") { p.x -= step; p.z = -LANE_2_OFFSET; this.mesh.rotation.y = Math.PI; }
                else if (this.approach === "W") { p.z -= step; p.x = LANE_2_OFFSET; this.mesh.rotation.y = Math.PI / 2; }
            }
        } else if (this.route === "left" && this.lane === 1) {
            // Strict Lane 1 Left-Turn Arc (R = 25.5m from inner lane into inner lane)
            const R = 25.5;
            const arcLen = (Math.PI / 2) * R;

            if (this.phase === "approach") {
                if (this.approach === "N") {
                    p.z -= step; p.x = LANE_1_OFFSET; this.mesh.rotation.y = Math.PI / 2;
                    if (p.z <= 17) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "E") {
                    p.x += step; p.z = LANE_1_OFFSET; this.mesh.rotation.y = 0;
                    if (p.x >= -17) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "S") {
                    p.z += step; p.x = -LANE_1_OFFSET; this.mesh.rotation.y = -Math.PI / 2;
                    if (p.z >= -17) { this.phase = "turning"; this.turnProgress = 0; }
                } else if (this.approach === "W") {
                    p.x -= step; p.z = -LANE_1_OFFSET; this.mesh.rotation.y = Math.PI;
                    if (p.x <= 17) { this.phase = "turning"; this.turnProgress = 0; }
                }
            } else if (this.phase === "turning") {
                this.turnProgress += step / arcLen;
                const angle = Math.min(this.turnProgress, 1.0) * (Math.PI / 2);

                if (this.approach === "N") {
                    p.x = -17 + R * Math.cos(angle);
                    p.z = 17 - R * Math.sin(angle);
                    this.mesh.rotation.y = Math.PI / 2 + angle;
                    if (this.turnProgress >= 1.0) { p.x = -17; p.z = -LANE_1_OFFSET; this.phase = "departure"; }
                } else if (this.approach === "E") {
                    p.x = -17 + R * Math.sin(angle);
                    p.z = 8.5 - R * (1 - Math.cos(angle));
                    this.mesh.rotation.y = angle;
                    if (this.turnProgress >= 1.0) { p.x = LANE_1_OFFSET; p.z = -17; this.phase = "departure"; }
                } else if (this.approach === "S") {
                    p.x = 17 - R * Math.cos(angle);
                    p.z = -17 + R * Math.sin(angle);
                    this.mesh.rotation.y = -Math.PI / 2 + angle;
                    if (this.turnProgress >= 1.0) { p.x = 17; p.z = LANE_1_OFFSET; this.phase = "departure"; }
                } else if (this.approach === "W") {
                    p.x = 17 - R * Math.sin(angle);
                    p.z = -8.5 + R * (1 - Math.cos(angle));
                    this.mesh.rotation.y = Math.PI + angle;
                    if (this.turnProgress >= 1.0) { p.x = -LANE_1_OFFSET; p.z = 17; this.phase = "departure"; }
                }
            } else {
                // Strict Departure in receiving inner lane (offset 8.5)
                if (this.approach === "N") { p.x -= step; p.z = -LANE_1_OFFSET; this.mesh.rotation.y = Math.PI; }
                else if (this.approach === "E") { p.z -= step; p.x = LANE_1_OFFSET; this.mesh.rotation.y = Math.PI / 2; }
                else if (this.approach === "S") { p.x += step; p.z = LANE_1_OFFSET; this.mesh.rotation.y = 0; }
                else if (this.approach === "W") { p.z += step; p.x = -LANE_1_OFFSET; this.mesh.rotation.y = -Math.PI / 2; }
            }
        }
    }

    isOutOfBounds() {
        if (this.phase === "hospital_arrived" || this.phase === "hospital_driveway" || this.phase.includes("hospital")) return false;
        const bound = 330;
        return (Math.abs(this.mesh.position.x) > bound || Math.abs(this.mesh.position.z) > bound);
    }

    destroy() {
        scene.remove(this.mesh);
    }
}

// Spawner Manager with strict lane-to-route discipline and visual clearance check
function spawnVehicle(approach, type = null) {
    if (!type) {
        const r = Math.random();
        type = r < 0.25 ? "bike" : (r < 0.80 ? "car" : "truck");
    }
    // Strict lane assignment: Lane 1 (Inner) or Lane 2 (Outer)
    const lane = Math.random() < 0.5 ? 1 : 2;

    // Check if spawn zone is clear on this lane
    const spawnDist = 310;
    const isSpawnBlocked = vehicles.some(v => {
        if (v.approach !== approach || v.lane !== lane || v.phase !== "approach") return false;
        const pos = (approach === "N" || approach === "S") ? v.mesh.position.z : v.mesh.position.x;
        if (approach === "N" && pos > spawnDist - 35) return true;
        if (approach === "S" && pos < -spawnDist + 35) return true;
        if (approach === "E" && pos < -spawnDist + 35) return true;
        if (approach === "W" && pos > spawnDist - 35) return true;
        return false;
    });

    if (isSpawnBlocked) {
        // Visual road is full: Add to virtual backlog for formula calculations without visual clutter
        const weight = type === "bike" ? 1 : (type === "truck" ? 4 : 2);
        state.virtualBacklog[approach].push({
            type,
            weight,
            lane,
            waitTime: 0.0
        });
        return;
    }

    // Strict lane-route discipline:
    // Lane 1 (Inner): 65% Straight, 35% Left Turn
    // Lane 2 (Outer): 65% Straight, 35% Right Turn
    let route = "straight";
    if (lane === 1) {
        route = Math.random() < 0.35 ? "left" : "straight";
    } else {
        route = Math.random() < 0.35 ? "right" : "straight";
    }

    const v = new Vehicle3D(approach, lane, route, type);
    vehicles.push(v);
}

function processVirtualBacklogs(dt) {
    approachKeys.forEach(approach => {
        const backlog = state.virtualBacklog[approach];
        if (!backlog || backlog.length === 0) return;

        // Update wait time for backlogged vehicles
        backlog.forEach(item => { item.waitTime += dt; });

        // Release oldest backlogged vehicle into 3D scene when space frees up
        for (let i = 0; i < backlog.length; i++) {
            const item = backlog[i];
            const lane = item.lane || (Math.random() < 0.5 ? 1 : 2);
            const spawnDist = 310;
            const isSpawnBlocked = vehicles.some(v => {
                if (v.approach !== approach || v.lane !== lane || v.phase !== "approach") return false;
                const pos = (approach === "N" || approach === "S") ? v.mesh.position.z : v.mesh.position.x;
                if (approach === "N" && pos > spawnDist - 35) return true;
                if (approach === "S" && pos < -spawnDist + 35) return true;
                if (approach === "E" && pos < -spawnDist + 35) return true;
                if (approach === "W" && pos > spawnDist - 35) return true;
                return false;
            });

            if (!isSpawnBlocked) {
                let route = "straight";
                if (lane === 1) {
                    route = Math.random() < 0.35 ? "left" : "straight";
                } else {
                    route = Math.random() < 0.35 ? "right" : "straight";
                }
                const v = new Vehicle3D(approach, lane, route, item.type);
                v.waitTime = item.waitTime;
                vehicles.push(v);
                backlog.splice(i, 1);
                i--;
            }
        }
    });
}

function spawnRandomVehiclesByInflow(dt) {
    approachKeys.forEach(app => {
        const inflowVal = state.inflowRates[app] !== undefined ? state.inflowRates[app] : 15;
        const ratePerSec = inflowVal / 60.0;
        if (ratePerSec > 0 && Math.random() < ratePerSec * dt) {
            spawnVehicle(app);
        }
    });
}

// ============================================================
// FCFS EMERGENCY AMBULANCE PREEMPTION CONTROLLER
// ============================================================

function triggerEmergencyAmbulance(specificApproach = null) {
    let approach = specificApproach;
    if (!approach || !approachKeys.includes(approach)) {
        approach = approachKeys[Math.floor(Math.random() * approachKeys.length)];
    }

    // Ambulance lane assignment: (S or W => Lane 2, N or E => Lane 1)
    const ambLane = (approach === "S" || approach === "W") ? 2 : 1;
    const amb = new Vehicle3D(approach, ambLane, "hospital", "ambulance");
    amb.speed = 52;
    vehicles.push(amb);

    const queueItem = {
        id: amb.id,
        seq: amb.ambulanceIndex,
        vehicle: amb,
        approach: approach,
        spawnTime: state.timeElapsed,
        hasCleared: false
    };
    state.ambulanceQueue.push(queueItem);

    if (!state.emergencyMode) {
        // Record the exact signal state BEFORE emergency preemption begins:
        // The side which currently had the green signal before the ambulance was seen
        const activeGreenApproach = approachKeys[state.currentPhaseIdx];
        const remainingGreen = Math.max(0, state.allocatedGreen - state.phaseElapsed);

        state.savedPreEmergencyState = {
            phaseIdx: state.currentPhaseIdx,
            approach: activeGreenApproach,
            subPhase: state.subPhase,
            phaseElapsed: state.phaseElapsed,
            allocatedGreen: state.allocatedGreen,
            remainingGreen: remainingGreen
        };

        state.emergencyMode = true;
        state.preemptionActive = true;
        state.preemptionApproach = queueItem.approach;
        state.dispatchPhase = "en_route";
        state.fcfsTransitionTimer = 0.0;
        state.isRestoringPostEmergency = false;
    }

    updateEmergencyBanner();
}

function handleAmbulanceSignalCleared(clearedAmb) {
    // Mark as cleared in the queue
    const idx = state.ambulanceQueue.findIndex(item => item.id === clearedAmb.id || item.vehicle === clearedAmb);
    if (idx !== -1) {
        state.ambulanceQueue[idx].hasCleared = true;
        if (idx === 0) {
            state.ambulanceQueue.shift();
        } else {
            state.ambulanceQueue.splice(idx, 1);
        }
    }

    // Purge any stale or destroyed vehicles
    state.ambulanceQueue = state.ambulanceQueue.filter(item => vehicles.includes(item.vehicle) && !item.hasCleared);

    if (state.ambulanceQueue.length > 0) {
        const nextAmb = state.ambulanceQueue[0];
        const prevApproach = clearedAmb.approach;

        if (nextAmb.approach !== prevApproach) {
            // FCFS Switch: Enforce 1.5s All-Red Safety Clearance for conflicting intersection paths
            state.fcfsTransitionTimer = 1.5;
            state.dispatchPhase = "clearing_switch";
            state.preemptionApproach = nextAmb.approach;
            updateEmergencyBanner(true);
        } else {
            // Next ambulance is from the same approach; keep green continuous!
            state.preemptionApproach = nextAmb.approach;
            state.dispatchPhase = "en_route";
            updateEmergencyBanner();
        }
    } else {
        // All queued ambulances have crossed the signal stop line
        endEmergencyMode();
    }
}

function endEmergencyMode() {
    if (!state.emergencyMode && state.ambulanceQueue.length === 0) return;
    state.emergencyMode = false;
    state.preemptionActive = false;
    state.dispatchPhase = "idle";
    state.ambulanceQueue = [];
    state.fcfsTransitionTimer = 0.0;

    // Immediately restore to all-red safety clearance before returning green to pre-emergency side
    state.subPhase = "all_red";
    state.phaseElapsed = 0.0;
    state.isRestoringPostEmergency = true;
    updateTrafficLightBulbs("CLR");

    const saved = state.savedPreEmergencyState;
    const restoredDirName = saved ? approachNames[saved.approach] : "Previous Side";
    const remSec = saved ? Math.ceil(saved.remainingGreen) : 0;
    const remText = remSec > 0 ? ` (${remSec}s remaining)` : "";

    const banner = document.getElementById("emergency-banner");
    if (banner) {
        banner.className = "emergency-banner cleared";
        banner.style.display = "flex";
        banner.innerHTML = `<span class="pulse-dot green"></span> <span>✅ <strong>Ambulance Cleared Signal</strong> — Resuming green on <strong>${restoredDirName}</strong>${remText}!</span>`;
        setTimeout(() => {
            if (!state.emergencyMode && state.ambulanceQueue.length === 0) {
                banner.style.display = "none";
                banner.className = "emergency-banner";
            }
        }, 4500);
    }
}

function updateEmergencyBanner(isTransitioning = false) {
    const banner = document.getElementById("emergency-banner");
    if (!banner) return;

    if (!state.emergencyMode && state.ambulanceQueue.length === 0) return;

    banner.style.display = "flex";

    if (isTransitioning) {
        const nextAmb = state.ambulanceQueue[0];
        const nextApproachName = nextAmb ? approachNames[nextAmb.approach] : "Next Approach";
        banner.innerHTML = `<span class="pulse-dot yellow"></span> <span>🔄 <strong>FCFS TRANSITION:</strong> Safety Clearance ➔ Switching Priority Green to <strong>${nextApproachName}</strong>!</span>`;
        return;
    }

    if (state.ambulanceQueue.length > 0) {
        const active = state.ambulanceQueue[0];
        const total = state.ambulanceQueue.length;
        const activeName = approachNames[active.approach];

        let queueText = "";
        if (total > 1) {
            const nextList = state.ambulanceQueue.slice(1).map((item, i) => `#${item.seq} ${approachNames[item.approach]}`).join(" ➔ ");
            queueText = ` <span class="fcfs-pill"><i class="fa-solid fa-list-ol"></i> FCFS Queue (${total}): <strong>${nextList}</strong></span>`;
        }

        banner.innerHTML = `<span class="pulse-dot red"></span> <span>🚨 <strong>FCFS PRIORITY:</strong> Green Corridor for Ambulance #${active.seq || 1} from <strong>${activeName}</strong> ➔ ER!${queueText}</span>`;
    }
}



// ============================================================
// THEME SWITCHER (MINIMALIST LIGHT & DARK MODES)
// ============================================================

function setTheme(themeMode) {
    state.theme = themeMode;
    const isLight = themeMode === "light";
    document.body.classList.toggle("light-mode", isLight);

    const themeIcon = document.getElementById("themeIcon");
    if (themeIcon) {
        themeIcon.className = isLight ? "fa-solid fa-moon" : "fa-solid fa-sun";
    }

    const btnThemeToggle = document.getElementById("btnThemeToggle");
    if (btnThemeToggle) {
        btnThemeToggle.title = isLight ? "Switch to Dark Mode" : "Switch to Light Mode";
    }

    // Update Three.js materials & lights
    if (isLight) {
        scene.background.setHex(0xf1f5f9);
        scene.fog.color.setHex(0xf1f5f9);
        scene.fog.density = 0.0007;

        materials.ground.color.setHex(0xe2e8f0);
        materials.road.color.setHex(0x272c34);
        materials.roadDark.color.setHex(0x1e2228);
        materials.sidewalk.color.setHex(0xcbd5e1);
        materials.curb.color.setHex(0x94a3b8);
        materials.concrete.color.setHex(0xcbd5e1);
        materials.concreteDark.color.setHex(0x94a3b8);
        materials.villaWhite.color.setHex(0xffffff);
        materials.roofSlate.color.setHex(0x475569);
        materials.metalDark.color.setHex(0x334155);
        hemisphereLight.color.setHex(0xffffff);
        hemisphereLight.groundColor.setHex(0xd8dde4);
        sunLight.color.setHex(0xfff8ee);
        sunLight.intensity = 3.4;
    } else {
        scene.background.setHex(0x000000);
        scene.fog.color.setHex(0x000000);
        scene.fog.density = 0.0008;

        materials.ground.color.setHex(0x07090c);
        materials.road.color.setHex(0x14171c);
        materials.roadDark.color.setHex(0x0c0e11);
        materials.sidewalk.color.setHex(0x363b42);
        materials.curb.color.setHex(0x4f555d);
        materials.concrete.color.setHex(0x73787C);
        materials.concreteDark.color.setHex(0x22262c);
        materials.villaWhite.color.setHex(0xC5C6C7);
        materials.roofSlate.color.setHex(0x121519);
        materials.metalDark.color.setHex(0x0a0c0e);
        hemisphereLight.color.setHex(0xffffff);
        hemisphereLight.groundColor.setHex(0x22262c);
        sunLight.color.setHex(0xffffff);
        sunLight.intensity = 3.2;
    }

    // Update Chart.js colors
    if (dashboard && dashboard.chartInstance) {
        dashboard.chartInstance.options.scales.x.grid.color = isLight ? "#e2e8f0" : "#1a1f26";
        dashboard.chartInstance.options.scales.x.ticks.color = isLight ? "#64748b" : "#73787C";
        dashboard.chartInstance.options.scales.y.grid.color = isLight ? "#e2e8f0" : "#1a1f26";
        dashboard.chartInstance.options.scales.y.ticks.color = isLight ? "#64748b" : "#73787C";
        dashboard.chartInstance.options.plugins.legend.labels.color = isLight ? "#0f172a" : "#C5C6C7";
        dashboard.refreshChartData();
    }

    try {
        localStorage.setItem("traffic_sim_theme", themeMode);
    } catch (e) {}
}

function resetCameraView() {
    controls.target.set(0, 0, 0);
    camera.position.set(280, 340, 280);
    camera.zoom = 1.0;
    camera.updateProjectionMatrix();
    controls.update();
    updateProjectedBadges();
}

// ============================================================
// DASHBOARD & CHART.JS PERFORMANCE MANAGER
// ============================================================

class DashboardManager {
    constructor() {
        this.chartInstance = null;
        this.historyData = { timestamps: [], waitTimes: [], queueLengths: [], gAllocations: [] };
        this.activeChartType = "wait";
        this.initChart();
    }

    initChart() {
        const ctx = document.getElementById("liveChart").getContext("2d");
        this.chartInstance = new Chart(ctx, {
            type: "line",
            data: {
                labels: [],
                datasets: [{
                    label: "Avg Waiting Time (s)",
                    data: [],
                    borderColor: "#C5C6C7",
                    backgroundColor: "rgba(197, 198, 199, 0.12)",
                    fill: true,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: "#C5C6C7", font: { family: "Plus Jakarta Sans" } } } },
                scales: {
                    x: { grid: { color: "#1a1f26" }, ticks: { color: "#73787C", font: { family: "JetBrains Mono" } } },
                    y: { grid: { color: "#1a1f26" }, ticks: { color: "#73787C", font: { family: "JetBrains Mono" } }, beginAtZero: true }
                }
            }
        });
    }

    updateMetrics(metrics, nextDirName, nextCalcRes, activePhaseName, activeDirKey) {
        // KPI Cards
        document.getElementById("kpiAvgWait").innerHTML = `${metrics.avgWait.toFixed(1)} <small>s</small>`;
        document.getElementById("kpiQueue").innerHTML = `${metrics.totalVehicles} <small>vehs</small>`;
        document.getElementById("kpiThroughput").innerText = metrics.throughput;
        document.getElementById("kpiSpeed").innerHTML = `${metrics.avgSpeed.toFixed(1)} <small>km/h</small>`;

        // 4-Side Allotted Green Grid & Live Vehicle Counts
        ["N", "E", "S", "W"].forEach(dir => {
            const gVal = (dir === activeDirKey) ? state.allocatedGreen : (state.preCalculatedGreens[dir] || 20);
            const valEl = document.getElementById(`allocG${dir === "N" ? "North" : (dir === "E" ? "East" : (dir === "S" ? "South" : "West"))}`);
            const cardEl = document.getElementById(`cardAlloc${dir}`);
            const statusEl = document.getElementById(`status${dir}`);
            const valVehEl = document.getElementById(`valVeh${dir}`);
            const subdetailEl = document.getElementById(`subdetail${dir}`);

            const dMetrics = metrics.directional[dir] || { count: 0, queue: 0, backlogCount: 0, bikes: 0, cars: 0, trucks: 0 };
            const Wt = (dMetrics.bikes || 0) + 2 * (dMetrics.cars || 0) + 4 * (dMetrics.trucks || 0);

            if (valEl) valEl.innerHTML = `${Math.round(gVal)} <small>sec</small>`;
            if (valVehEl) valVehEl.innerText = dMetrics.count;
            if (subdetailEl) {
                const backlogStr = dMetrics.backlogCount > 0 ? ` (+${dMetrics.backlogCount} b/log)` : "";
                subdetailEl.innerText = `Q: ${dMetrics.queue}${backlogStr} | Wt: ${Wt}`;
            }

            if (cardEl && statusEl) {
                if (state.emergencyMode) {
                    if (dir === state.preemptionApproach) {
                        cardEl.classList.add("active");
                        statusEl.innerText = state.fcfsTransitionTimer > 0 ? "SAFETY CLEARANCE" : "🚨 EMERGENCY GREEN";
                    } else {
                        cardEl.classList.remove("active");
                        statusEl.innerText = "WAITING (RED)";
                    }
                } else if (state.isRestoringPostEmergency && state.savedPreEmergencyState) {
                    if (dir === state.savedPreEmergencyState.approach) {
                        cardEl.classList.add("active");
                        statusEl.innerText = "RESTORING GREEN NEXT";
                    } else {
                        cardEl.classList.remove("active");
                        statusEl.innerText = "RED (SAFETY CLEARANCE)";
                    }
                } else if (dir === activeDirKey) {
                    cardEl.classList.add("active");
                    statusEl.innerText = state.subPhase === "yellow" ? "CAUTION YELLOW" : (state.subPhase === "all_red" ? "ALL-RED SAFETY" : "ACTIVE GREEN");
                } else {
                    cardEl.classList.remove("active");
                    statusEl.innerText = "PRE-CALCULATED";
                }
            }
        });

        // Active Turn Badge
        if (state.emergencyMode) {
            document.getElementById("pillActiveTurn").innerText = `🚨 EMERGENCY: ${approachNames[state.preemptionApproach]} PRIORITY CORRIDOR`;
        } else if (state.isRestoringPostEmergency && state.savedPreEmergencyState) {
            document.getElementById("pillActiveTurn").innerText = `🔄 RESTORING: ${approachNames[state.savedPreEmergencyState.approach]} (NEXT)`;
        } else {
            document.getElementById("pillActiveTurn").innerText = `ACTIVE TURN: ${approachNames[activeDirKey]} (${Math.round(state.allocatedGreen)}s)`;
        }

        // Upcoming Side Breakdown
        if (document.getElementById("nextDirName")) document.getElementById("nextDirName").innerText = nextDirName;
        if (nextCalcRes) {
            document.getElementById("calcInOut").innerText = `${nextCalcRes.inflow} / ${nextCalcRes.outflow} v/m`;
            document.getElementById("calcQ").innerText = `${nextCalcRes.Q} vehs`;
            document.getElementById("calcL").innerText = nextCalcRes.l.toFixed(2);
            document.getElementById("calcR").innerText = nextCalcRes.r.toFixed(2);
            document.getElementById("calcG").innerText = `${nextCalcRes.G}s`;
        }

        // Progress bar
        const totalDuration = state.subPhase === "green" ? state.allocatedGreen : (state.subPhase === "yellow" ? state.yellowDuration : state.allRedDuration);
        const pct = Math.min(100, (state.phaseElapsed / Math.max(1, totalDuration)) * 100);
        document.getElementById("phaseProgressBar").style.width = `${pct}%`;
        document.getElementById("txtPhaseActive").innerText = `Active Phase: ${activePhaseName}`;
        document.getElementById("txtPhaseRemaining").innerText = `Time Remaining: ${Math.max(0, totalDuration - state.phaseElapsed).toFixed(0)}s`;

        // Update Chart History
        if (Math.round(state.timeElapsed) % 2 === 0) {
            const timeStr = `${Math.floor(state.timeElapsed / 60)}:${(Math.floor(state.timeElapsed) % 60).toString().padStart(2, "0")}`;
            if (this.historyData.timestamps[this.historyData.timestamps.length - 1] !== timeStr) {
                this.historyData.timestamps.push(timeStr);
                this.historyData.waitTimes.push(metrics.avgWait);
                this.historyData.queueLengths.push(metrics.totalVehicles);
                this.historyData.gAllocations.push(state.allocatedGreen);

                if (this.historyData.timestamps.length > 40) {
                    this.historyData.timestamps.shift();
                    this.historyData.waitTimes.shift();
                    this.historyData.queueLengths.shift();
                    this.historyData.gAllocations.shift();
                }
                this.refreshChartData();
            }
        }
    }

    setChartType(type) {
        this.activeChartType = type;
        document.querySelectorAll(".chart-toggle .btn").forEach(b => b.classList.remove("active"));
        if (type === "wait") document.getElementById("btnShowWaitChart").classList.add("active");
        if (type === "queue") document.getElementById("btnShowQueueChart").classList.add("active");
        if (type === "green") document.getElementById("btnShowGChart").classList.add("active");
        this.refreshChartData();
    }

    refreshChartData() {
        if (!this.chartInstance) return;
        this.chartInstance.data.labels = this.historyData.timestamps;

        if (this.activeChartType === "wait") {
            this.chartInstance.data.datasets = [{
                label: "Avg Waiting Time (s)",
                data: this.historyData.waitTimes,
                borderColor: "#C5C6C7",
                backgroundColor: "rgba(197, 198, 199, 0.15)",
                fill: true,
                tension: 0.3
            }];
        } else if (this.activeChartType === "queue") {
            this.chartInstance.data.datasets = [{
                label: "Active Vehicles Present (vehs)",
                data: this.historyData.queueLengths,
                borderColor: "#73787C",
                backgroundColor: "rgba(115, 120, 124, 0.18)",
                fill: true,
                tension: 0.3
            }];
        } else if (this.activeChartType === "green") {
            this.chartInstance.data.datasets = [{
                label: "Allotted Green Duration G (s)",
                data: this.historyData.gAllocations,
                borderColor: "#ffffff",
                backgroundColor: "rgba(255, 255, 255, 0.12)",
                fill: true,
                tension: 0.3
            }];
        }
        this.chartInstance.update("none");
    }
}

const dashboard = new DashboardManager();

// ============================================================
// DYNAMIC 3D SCREEN-SPACE PROJECTED BADGES & COMPASS
// ============================================================

const ROAD_END_DIST = 255;

const approachAnchors = {
    N: new THREE.Vector3(0, 8, ROAD_END_DIST),
    S: new THREE.Vector3(0, 8, -ROAD_END_DIST),
    E: new THREE.Vector3(-ROAD_END_DIST, 8, 0),
    W: new THREE.Vector3(ROAD_END_DIST, 8, 0)
};

const _projVector = new THREE.Vector3();

function updateProjectedBadges() {
    const w = canvasWrapper.clientWidth || 600;
    const h = canvasWrapper.clientHeight || 520;
    const halfW = w / 2;
    const halfH = h / 2;

    ["N", "E", "S", "W"].forEach(dir => {
        const badgeId = `badge${dir === "N" ? "North" : (dir === "E" ? "East" : (dir === "S" ? "South" : "West"))}`;
        const el = document.getElementById(badgeId);
        if (!el) return;

        _projVector.copy(approachAnchors[dir]);
        _projVector.project(camera);

        // Convert normalized device coordinates [-1, 1] to screen pixel coordinates
        let sx = (_projVector.x * halfW) + halfW;
        let sy = -(_projVector.y * halfH) + halfH;

        // Smoothly clamp within visible boundaries so labels stay attached and readable
        const padX = 85;
        const padY = 28;
        sx = Math.max(padX, Math.min(w - padX, sx));
        sy = Math.max(padY, Math.min(h - padY, sy));

        el.style.left = `${sx}px`;
        el.style.top = `${sy}px`;
    });

    // Rotate the 3D compass rose in real-time according to camera azimuthal orientation
    const compassRose = document.getElementById("compassRose");
    if (compassRose) {
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        const angleDeg = (Math.atan2(camDir.x, camDir.z) * 180 / Math.PI);
        compassRose.style.transform = `rotate(${angleDeg + 135}deg)`;
    }
}

// ============================================================
// VEHICLE HUD & RAYCASTING
// ============================================================

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function updateVehicleHud(entity) {
    const card = document.getElementById("vehicle-card");
    if (!entity) {
        card.style.display = "none";
        return;
    }
    card.style.display = "block";
    document.getElementById("vc-type").innerText = `${entity.type.toUpperCase()} #${entity.id}`;
    document.getElementById("vc-approach").innerText = approachNames[entity.approach] || entity.approach;
    document.getElementById("vc-lane").innerText = `Lane ${entity.lane} (${entity.route.toUpperCase()})`;
    document.getElementById("vc-speed").innerText = `${Math.round(entity.speed * 1.8)} km/h`;
    document.getElementById("vc-action").innerText = entity.status;
}

canvasWrapper.addEventListener("click", e => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const vehicleMeshes = vehicles.map(v => v.mesh);
    const intersects = raycaster.intersectObjects(vehicleMeshes, true);

    if (intersects.length > 0) {
        let topMesh = intersects[0].object;
        while (topMesh.parent && !topMesh.userData.vehicle) {
            topMesh = topMesh.parent;
        }
        if (topMesh.userData.vehicle) {
            state.selectedVehicle = topMesh.userData.vehicle;
            updateVehicleHud(state.selectedVehicle);
        }
    }
});

document.getElementById("btn-close-hud")?.addEventListener("click", () => {
    state.selectedVehicle = null;
    updateVehicleHud(null);
    if (state.cameraMode === "follow") setCameraMode("iso");
});

document.getElementById("btn-follow")?.addEventListener("click", () => {
    if (state.selectedVehicle) {
        state.cameraMode = "follow";
    }
});

// ============================================================
// SIMULATION STEP & METRICS COMPUTATION
// ============================================================

function computeLiveMetrics() {
    let totalBikes = 0, totalCars = 0, totalTrucks = 0;
    let totalWait = 0.0, totalSpeed = 0.0, queuedCount = 0;
    const dirMetrics = {};

    approachKeys.forEach(d => {
        const appVehs = vehicles.filter(v => v.approach === d && v.phase === "approach");
        const backlog = state.virtualBacklog[d] || [];

        const visibleBikes = appVehs.filter(v => v.type === "bike").length;
        const visibleCars = appVehs.filter(v => v.type === "car").length;
        const visibleTrucks = appVehs.filter(v => v.type === "truck" || v.type === "ambulance").length;
        const visibleQueued = appVehs.filter(v => v.isQueued).length;
        const visibleWaitSum = appVehs.reduce((sum, v) => sum + v.waitTime, 0.0);
        const visibleSpeedSum = appVehs.reduce((sum, v) => sum + v.speed, 0.0);

        // Virtual backlog metrics (counted in mathematical calculations)
        const backlogBikes = backlog.filter(v => v.type === "bike").length;
        const backlogCars = backlog.filter(v => v.type === "car").length;
        const backlogTrucks = backlog.filter(v => v.type === "truck").length;
        const backlogQueued = backlog.length;
        const backlogWaitSum = backlog.reduce((sum, v) => sum + v.waitTime, 0.0);

        const bikes = visibleBikes + backlogBikes;
        const cars = visibleCars + backlogCars;
        const trucks = visibleTrucks + backlogTrucks;
        const totalApproachVehicles = appVehs.length + backlog.length;
        const queued = visibleQueued + backlogQueued;
        const waitSum = visibleWaitSum + backlogWaitSum;

        totalBikes += bikes;
        totalCars += cars;
        totalTrucks += trucks;
        queuedCount += queued;
        totalWait += waitSum;
        totalSpeed += visibleSpeedSum;

        dirMetrics[d] = {
            bikes,
            cars,
            trucks,
            count: totalApproachVehicles,
            queue: queued,
            backlogCount: backlog.length,
            wait: totalApproachVehicles > 0 ? waitSum / totalApproachVehicles : 0.0
        };
    });

    const totalBacklogCount = Object.values(state.virtualBacklog).reduce((s, b) => s + b.length, 0);
    const activeCount = vehicles.length + totalBacklogCount;
    const avgWait = activeCount > 0 ? totalWait / activeCount : 0.0;
    const avgSpeed = vehicles.length > 0 ? (totalSpeed / vehicles.length) * 1.8 : 0.0;

    return {
        totalVehicles: activeCount,
        bikes: totalBikes,
        cars: totalCars,
        trucks: totalTrucks,
        queueLength: queuedCount,
        totalBacklog: totalBacklogCount,
        avgWait,
        avgSpeed,
        throughput: state.passedVehiclesCount,
        directional: dirMetrics
    };
}

function updateSignalState(dt, metrics) {
    // 1. Calculate Baseline Formula Greens for all approaches
    approachKeys.forEach(dir => {
        const res = SignalControllers.calculateBaselineFormulaG(dir, metrics.directional[dir], state.formulaParams);
        state.preCalculatedGreens[dir] = res.G;
    });

    if (state.emergencyMode) {
        if (state.fcfsTransitionTimer > 0) {
            state.fcfsTransitionTimer -= dt;
            if (state.fcfsTransitionTimer <= 0) {
                state.fcfsTransitionTimer = 0.0;
                state.dispatchPhase = "en_route";
                if (state.ambulanceQueue.length > 0) {
                    state.preemptionApproach = state.ambulanceQueue[0].approach;
                }
                updateEmergencyBanner();
            }
            updateTrafficLightBulbs("CLR");
            return;
        }
        updateTrafficLightBulbs("EMERG");
        return;
    }

    const currentDir = approachKeys[state.currentPhaseIdx];
    state.phaseElapsed += dt;

    if (state.subPhase === "green") {
        const remaining = Math.max(0, state.allocatedGreen - state.phaseElapsed);
        updateTrafficLightBulbs(Math.ceil(remaining).toString());

        if (state.phaseElapsed >= state.allocatedGreen) {
            state.subPhase = "yellow";
            state.phaseElapsed = 0.0;
        }
    } else if (state.subPhase === "yellow") {
        const remaining = Math.max(0, state.yellowDuration - state.phaseElapsed);
        updateTrafficLightBulbs(Math.ceil(remaining).toString());

        if (state.phaseElapsed >= state.yellowDuration) {
            state.subPhase = "all_red";
            state.phaseElapsed = 0.0;
        }
    } else if (state.subPhase === "all_red") {
        updateTrafficLightBulbs("CLR");

        if (state.phaseElapsed >= state.allRedDuration) {
            state.subPhase = "green";
            state.phaseElapsed = 0.0;

            if (state.isRestoringPostEmergency && state.savedPreEmergencyState) {
                // Restore green back to the side which had the green signal before the ambulance was seen
                state.currentPhaseIdx = state.savedPreEmergencyState.phaseIdx;
                const restoredDir = approachKeys[state.currentPhaseIdx];
                const rem = state.savedPreEmergencyState.remainingGreen;

                // Resume exactly the remaining green time that was left when interrupted (e.g., 16s left -> 16s on return)
                state.allocatedGreen = rem > 0 ? rem : (state.preCalculatedGreens[restoredDir] || state.formulaParams.gmin);
                state.isRestoringPostEmergency = false;
                state.savedPreEmergencyState = null;
            } else {
                // Normal sequential phase progression: N -> E -> S -> W
                state.currentPhaseIdx = (state.currentPhaseIdx + 1) % 4;
                const newDir = approachKeys[state.currentPhaseIdx];
                state.allocatedGreen = state.preCalculatedGreens[newDir] || state.formulaParams.gmin;
            }
        }
    }
}

function updateTrafficLightBulbs(secText = "30") {
    const isTransition = state.emergencyMode && state.fcfsTransitionTimer > 0;
    const activeDir = state.emergencyMode ? (isTransition ? null : state.preemptionApproach) : (state.subPhase === "all_red" ? null : approachKeys[state.currentPhaseIdx]);
    const isYellow = !state.emergencyMode && (state.subPhase === "yellow");

    laneSignalHeads.forEach(item => {
        let isRed = true;
        let isYel = false;
        let isGrn = false;

        if (item.approach === activeDir) {
            if (isYellow) {
                isYel = true;
                isRed = false;
            } else {
                isGrn = true;
                isRed = false;
            }
        }

        const h = item.head;
        h.redMat.color.setHex(isRed ? 0xff2222 : 0x220505);
        h.redMat.emissive.setHex(isRed ? 0xff0000 : 0x000000);
        h.redMat.emissiveIntensity = isRed ? 2.5 : 0;

        h.yellowMat.color.setHex(isYel ? 0xffcc00 : 0x221a05);
        h.yellowMat.emissive.setHex(isYel ? 0xffaa00 : 0x000000);
        h.yellowMat.emissiveIntensity = isYel ? 2.5 : 0;

        h.greenMat.color.setHex(isGrn ? 0x22c55e : 0x05220c);
        h.greenMat.emissive.setHex(isGrn ? 0x22c55e : 0x000000);
        h.greenMat.emissiveIntensity = isGrn ? 2.5 : 0;

        const timerColor = isGrn ? "#22c55e" : (isYel ? "#f59e0b" : "#ef4444");
        h.timerMat.map.dispose();
        h.timerMat.map = createCountdownCanvasTexture(secText, timerColor);
    });

    // Update 2D Overlay Badges
    const updateBadge = (id, dirName, dirKey) => {
        const badge = document.getElementById(id);
        if (!badge) return;
        
        const sideVehCount = vehicles.filter(v => v.approach === dirKey && v.phase === "approach").length + (state.virtualBacklog[dirKey]?.length || 0);
        const vehSuffix = ` [${sideVehCount} vehs]`;

        if (state.emergencyMode) {
            if (isTransition) {
                badge.innerText = `🛑 ${dirName}: CLEARING${vehSuffix}`;
                badge.style.background = "rgba(245, 158, 11, 0.92)";
                badge.style.borderColor = "rgba(251, 191, 36, 0.8)";
                badge.style.color = "#fff";
            } else if (dirKey === state.preemptionApproach) {
                const activeSeq = state.ambulanceQueue[0]?.seq;
                badge.innerText = `🚨 ${dirName}: FCFS #${activeSeq || 1}${vehSuffix}`;
                badge.style.background = "rgba(16, 185, 129, 0.92)";
                badge.style.borderColor = "rgba(52, 211, 153, 0.8)";
                badge.style.color = "#fff";
            } else {
                const queuePos = state.ambulanceQueue.findIndex(q => q.approach === dirKey && !q.hasCleared);
                if (queuePos > 0) {
                    badge.innerText = `⏳ ${dirName}: QUEUED #${queuePos + 1}${vehSuffix}`;
                    badge.style.background = "rgba(180, 83, 9, 0.92)";
                    badge.style.borderColor = "rgba(245, 158, 11, 0.8)";
                    badge.style.color = "#fff";
                } else {
                    badge.innerText = `🔴 ${dirName}: RED${vehSuffix}`;
                    badge.style.background = "rgba(239, 68, 68, 0.9)";
                    badge.style.borderColor = "rgba(248, 113, 113, 0.8)";
                    badge.style.color = "#fff";
                }
            }
        } else if (state.subPhase === "all_red") {
            badge.innerText = `🛑 ${dirName}: ALL-RED${vehSuffix}`;
            badge.style.background = "rgba(239, 68, 68, 0.9)";
            badge.style.borderColor = "rgba(248, 113, 113, 0.8)";
            badge.style.color = "#fff";
        } else if (dirKey === activeDir) {
            if (isYellow) {
                badge.innerText = `⚠️ ${dirName}: ${secText}s YEL${vehSuffix}`;
                badge.style.background = "rgba(245, 158, 11, 0.92)";
                badge.style.borderColor = "rgba(251, 191, 36, 0.8)";
                badge.style.color = "#fff";
            } else {
                badge.innerText = `🟢 ${dirName}: ${secText}s${vehSuffix}`;
                badge.style.background = "rgba(16, 185, 129, 0.92)";
                badge.style.borderColor = "rgba(52, 211, 153, 0.8)";
                badge.style.color = "#fff";
            }
        } else {
            badge.innerText = `🔴 ${dirName}: RED${vehSuffix}`;
            badge.style.background = "rgba(239, 68, 68, 0.9)";
            badge.style.borderColor = "rgba(248, 113, 113, 0.8)";
            badge.style.color = "#fff";
        }
    };

    updateBadge("badgeNorth", "NORTH", "N");
    updateBadge("badgeEast", "EAST", "E");
    updateBadge("badgeSouth", "SOUTH", "S");
    updateBadge("badgeWest", "WEST", "W");
}

// ============================================================
// MAIN ANIMATION & LOGIC LOOP
// ============================================================

const clock = new THREE.Clock();
let fpsCounter = 0;
let lastFpsTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    if (!state.isRunning) {
        controls.update();
        updateProjectedBadges();
        renderer.render(scene, camera);
        return;
    }

    const rawDelta = Math.min(clock.getDelta(), 0.1);
    const dt = rawDelta * state.simSpeed;
    state.timeElapsed += dt;

    // Simulation Clock
    const totalSec = Math.floor(state.timeElapsed);
    const hrs = Math.floor(totalSec / 3600).toString().padStart(2, "0");
    const mins = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
    const secs = (totalSec % 60).toString().padStart(2, "0");
    document.getElementById("simClock").innerText = `${hrs}:${mins}:${secs}`;

    // Vehicle Spawning by Inflow Rates & Backlog Release
    spawnRandomVehiclesByInflow(dt);
    processVirtualBacklogs(dt);

    // Update Vehicles Smoothly
    for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i];
        v.update(dt);

        if (v.isOutOfBounds()) {
            v.destroy();
            vehicles.splice(i, 1);
            state.passedVehiclesCount++;
            if (state.selectedVehicle === v) {
                state.selectedVehicle = null;
                updateVehicleHud(null);
            }
        }
    }

    controls.update();
    updateProjectedBadges();

    // Compute Metrics & Update Signal State
    const metrics = computeLiveMetrics();
    updateSignalState(dt, metrics);

    // Update Next Phase Decision Information
    const nextPhaseIdx = (state.currentPhaseIdx + 1) % 4;
    const nextDirKey = approachKeys[nextPhaseIdx];
    const nextDirName = approachNames[nextDirKey];
    const nextCalcRes = SignalControllers.calculateBaselineFormulaG(nextDirKey, metrics.directional[nextDirKey], state.formulaParams);

    let activeDirKey = approachKeys[state.currentPhaseIdx];
    let activePhaseName = state.subPhase === "yellow" ? "YELLOW CAUTION" : (state.subPhase === "all_red" ? "ALL-RED SAFETY" : `${approachNames[activeDirKey]} GREEN`);

    if (state.emergencyMode) {
        activeDirKey = state.preemptionApproach;
        activePhaseName = state.fcfsTransitionTimer > 0 ? "SAFETY ALL-RED CLEARANCE" : `🚨 ${approachNames[state.preemptionApproach]} PRIORITY GREEN`;
    } else if (state.isRestoringPostEmergency && state.savedPreEmergencyState) {
        activePhaseName = `🛑 ALL-RED CLEARANCE ➔ Restoring ${approachNames[state.savedPreEmergencyState.approach]} GREEN`;
    }

    dashboard.updateMetrics(metrics, nextDirName, nextCalcRes, activePhaseName, activeDirKey);

    // Update HUD if open
    if (state.selectedVehicle) updateVehicleHud(state.selectedVehicle);

    // FPS Meter
    fpsCounter++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
        state.fps = Math.round((fpsCounter * 1000) / (now - lastFpsTime));
        fpsCounter = 0;
        lastFpsTime = now;
        const fpsEl = document.getElementById("stat-fps");
        if (fpsEl) fpsEl.textContent = state.fps;
    }

    renderer.render(scene, camera);
}

// ============================================================
// UI EVENT LISTENERS
// ============================================================

function initEventListeners() {
    document.getElementById("btnPausePlay").addEventListener("click", () => {
        state.isRunning = !state.isRunning;
        document.getElementById("btnPausePlay").innerHTML = state.isRunning ?
            '<i class="fa-solid fa-pause"></i> Pause' : '<i class="fa-solid fa-play"></i> Play';
        document.getElementById("simStatusBadge").className = state.isRunning ? "status-badge live" : "status-badge paused";
    });

    document.getElementById("btnReset").addEventListener("click", () => {
        while (vehicles.length > 0) {
            vehicles.pop().destroy();
        }
        state.virtualBacklog = { N: [], E: [], S: [], W: [] };
        state.timeElapsed = 0.0;
        state.passedVehiclesCount = 0;
        state.currentPhaseIdx = 0;
        state.subPhase = "green";
        state.phaseElapsed = 0.0;
        state.allocatedGreen = state.formulaParams.gmin;
        state.selectedVehicle = null;
        state.savedPreEmergencyState = null;
        state.isRestoringPostEmergency = false;
        updateVehicleHud(null);
        endEmergencyMode();
        resetCameraView();
    });

    document.getElementById("speedSelect").addEventListener("change", e => {
        state.simSpeed = parseFloat(e.target.value);
    });

    document.getElementById("btnEmergency").addEventListener("click", () => {
        triggerEmergencyAmbulance();
    });

    // Compass click resets orientation
    document.getElementById("compassWidget")?.addEventListener("click", resetCameraView);

    // Re-align projected badges immediately on OrbitControls mouse drag
    controls.addEventListener("change", updateProjectedBadges);

    // Inflow sliders
    const setupInflowSlider = (sliderId, displayId, key) => {
        const s = document.getElementById(sliderId);
        s?.addEventListener("input", e => {
            const val = parseInt(e.target.value);
            document.getElementById(displayId).innerText = `${val} veh/min`;
            state.inflowRates[key] = val;
        });
    };
    setupInflowSlider("sliderInflowN", "valInflowN", "N");
    setupInflowSlider("sliderInflowE", "valInflowE", "E");
    setupInflowSlider("sliderInflowS", "valInflowS", "S");
    setupInflowSlider("sliderInflowW", "valInflowW", "W");

    // Outflow sliders
    const setupOutflowSlider = (sliderId, displayId, key) => {
        const s = document.getElementById(sliderId);
        s?.addEventListener("input", e => {
            const val = parseInt(e.target.value);
            document.getElementById(displayId).innerText = `${val} veh/min`;
            state.outflowRates[key] = val;
        });
    };
    setupOutflowSlider("sliderOutflowN", "valOutflowN", "N");
    setupOutflowSlider("sliderOutflowE", "valOutflowE", "E");
    setupOutflowSlider("sliderOutflowS", "valOutflowS", "S");
    setupOutflowSlider("sliderOutflowW", "valOutflowW", "W");

    // Formula Tuner Sliders
    document.getElementById("sliderAlpha")?.addEventListener("input", e => {
        state.formulaParams.alpha = parseFloat(e.target.value);
        document.getElementById("valAlpha").innerText = state.formulaParams.alpha.toFixed(1);
    });
    document.getElementById("sliderGamma")?.addEventListener("input", e => {
        state.formulaParams.gamma = parseFloat(e.target.value);
        document.getElementById("valGamma").innerText = state.formulaParams.gamma.toFixed(1);
    });
    document.getElementById("sliderGmin")?.addEventListener("input", e => {
        state.formulaParams.gmin = parseInt(e.target.value);
        document.getElementById("valGmin").innerText = `${state.formulaParams.gmin}s`;
    });

    // Theme toggle button
    document.getElementById("btnThemeToggle")?.addEventListener("click", () => {
        const newTheme = state.theme === "light" ? "dark" : "light";
        setTheme(newTheme);
    });

    // Chart toggles
    document.getElementById("btnShowWaitChart")?.addEventListener("click", () => dashboard.setChartType("wait"));
    document.getElementById("btnShowQueueChart")?.addEventListener("click", () => dashboard.setChartType("queue"));
    document.getElementById("btnShowGChart")?.addEventListener("click", () => dashboard.setChartType("green"));

    // Window Resize Observer for 3D Viewport
    const onResize = () => {
        const w = canvasWrapper.clientWidth || 600;
        const h = canvasWrapper.clientHeight || 520;
        const newAspect = w / h;

        camera.left = -viewSize * newAspect;
        camera.right = viewSize * newAspect;
        camera.top = viewSize;
        camera.bottom = -viewSize;
        camera.updateProjectionMatrix();

        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        updateProjectedBadges();
    };

    window.addEventListener("resize", onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvasWrapper);
}

// ============================================================
// INITIALIZATION
// ============================================================

initEventListeners();
const savedTheme = localStorage.getItem("traffic_sim_theme") || "dark";
setTheme(savedTheme);
updateTrafficLightBulbs("20");
updateProjectedBadges();
animate();

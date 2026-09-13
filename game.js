// ТАЗЫ RUNNER — endless runner в казахском стиле
// Герой: тазы (казахская борзая), процедурная 3D-модель + анимация галопа
import * as THREE from 'three';

// ============================================================ CONSTANTS
const LANE_X = [-2.3, 0, 2.3];
const SPAWN_Z = -110;
const KILL_Z = 14;
const GRAVITY = -34;        // читаемая дуга: достаточно времени увидеть и перелететь плетень
const JUMP_VY = 10.8;
const JUMP_CUT_VY = 8;      // даже короткое нажатие уверенно переносит через плетень
const FASTFALL_VY = -18;
const SLIDE_TIME = 0.62;
const LANE_TWEEN = 0.18;
const START_SPEED = 12;
const MAX_SPEED = 26;
const COUNTDOWN = 2.0;      // отсчёт перед разгоном
const DEBUG_DOG = new URLSearchParams(location.search).get('debug') === 'dog';

// Контрастная палитра степи
const C = {
  coat: 0xd68b32,
  coatLight: 0xf4c978,
  coatDark: 0x653319,
  nose: 0x140b08,
  mountain: 0x52629a,
  mountainSnow: 0xfff5dc,
  felt: 0xffe8b9,
  ornRed: 0xa61524,
  gold: 0xffbd18,
  wood: 0x653613,
};

// ============================================================ RENDERER / SCENE
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe6a84c, 68, 145);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 300);
camera.position.set(0, 3.4, 7.2);
camera.lookAt(0, 1.1, -4);
// игровая позиция камеры: ниже и ближе — собака крупнее, скорость злее
const CAM = { xOffset: 0.55, y: 2.9, z: 6.2, lookY: 1.0, lookZ: -6 };

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- Небо: сочный градиент «золотой час»
{
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0754b8');
  gr.addColorStop(0.44, '#35a7e8');
  gr.addColorStop(0.73, '#ffd15a');
  gr.addColorStop(1, '#f18b2b');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

// ---- Свет: тёплое низкое солнце
scene.add(new THREE.HemisphereLight(0xc5e8ff, 0x80501d, 1.3));
const sun = new THREE.DirectionalLight(0xffdf9a, 2.8);
sun.position.set(14, 20, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
sun.shadow.camera.far = 80;
scene.add(sun);

// ============================================================ MATERIAL HELPERS
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
const M = {
  coat: mat(C.coat),
  coatDark: mat(C.coatDark, { roughness: 0.75 }),
  nose: mat(C.nose, { roughness: 0.4 }),
  eye: mat(0x241608, { roughness: 0.25, metalness: 0.3 }),
  felt: mat(C.felt, { roughness: 0.95 }),
  ornRed: mat(C.ornRed),
  gold: mat(C.gold, { roughness: 0.3, metalness: 0.5, emissive: 0x6a4a00, emissiveIntensity: 0.55 }),
  wood: mat(C.wood, { roughness: 0.9 }),
  camel: mat(0xbb9055),
  stone: mat(0x978d7e, { roughness: 0.95 }),
};

function addMesh(parent, geo, material, x = 0, y = 0, z = 0, castShadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  parent.add(m);
  return m;
}

// ============================================================ ЛОФТ-ГЕОМЕТРИЯ
// Гладкое «тело» вдоль сплайна: эллиптические сечения с разной шириной/глубиной.
// Сплайн должен идти преимущественно в +Z (тогда «верх» сечения — мировой верх).
function makeLoft(spinePts, stations, opts = {}) {
  const rad = opts.radialSegments || 16;
  const rings = opts.rings || 48;
  const curve = new THREE.CatmullRomCurve3(spinePts);
  const stationAt = (t) => {
    let a = stations[0], b = stations[stations.length - 1];
    for (let i = 0; i < stations.length - 1; i++) {
      if (t >= stations[i].t && t <= stations[i + 1].t) { a = stations[i]; b = stations[i + 1]; break; }
    }
    const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
    const s = k * k * (3 - 2 * k);
    const L = (x, y) => x + (y - x) * s;
    return { rx: L(a.rx, b.rx), ryT: L(a.ryT, b.ryT), ryB: L(a.ryB, b.ryB) };
  };
  const pos = [], col = [], idx = [];
  const cUp = new THREE.Color(opts.colorUp ?? C.coatDark);
  const cMid = new THREE.Color(opts.colorMid ?? C.coat);
  const cDn = new THREE.Color(opts.colorDown ?? C.coatLight);
  const S = new THREE.Vector3(1, 0, 0);
  const tmp = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const U = new THREE.Vector3(0, T.z, -T.y).normalize();
    const st = stationAt(t);
    for (let j = 0; j <= rad; j++) {
      const th = (j / rad) * Math.PI * 2;
      const cs = Math.cos(th), sn = Math.sin(th);
      const ry = sn > 0 ? st.ryT : st.ryB;
      pos.push(
        P.x + S.x * st.rx * cs + U.x * ry * sn,
        P.y + S.y * st.rx * cs + U.y * ry * sn,
        P.z + S.z * st.rx * cs + U.z * ry * sn
      );
      if (sn > 0) tmp.lerpColors(cMid, cUp, sn * (opts.upStrength ?? 0.55));
      else tmp.lerpColors(cMid, cDn, -sn * (opts.downStrength ?? 0.7));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + rad + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

// ============================================================ ТАЗЫ — МОДЕЛЬ СОБАКИ
// Пропорции настоящей тазы: глубокая грудь, резко подтянутый живот,
// длинные сухие ноги, длинная узкая голова, висячие уши с очёсами,
// длинный тонкий хвост серпом. Бежит в сторону -Z.
function createTazy() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---------- ТУЛОВИЩЕ: единый гладкий лофт от плеч до основания хвоста
  const torso = makeLoft(
    [
      new THREE.Vector3(0, 1.28, -0.66),
      new THREE.Vector3(0, 1.32, -0.38),
      new THREE.Vector3(0, 1.31, -0.05),
      new THREE.Vector3(0, 1.28, 0.28),
      new THREE.Vector3(0, 1.2, 0.58),
      new THREE.Vector3(0, 1.05, 0.8),
    ],
    [
      { t: 0.0, rx: 0.12, ryT: 0.11, ryB: 0.16 },
      { t: 0.16, rx: 0.22, ryT: 0.18, ryB: 0.34 },
      { t: 0.34, rx: 0.205, ryT: 0.18, ryB: 0.31 },
      { t: 0.56, rx: 0.13, ryT: 0.13, ryB: 0.1 },
      { t: 0.78, rx: 0.19, ryT: 0.18, ryB: 0.19 },
      { t: 1.0, rx: 0.07, ryT: 0.07, ryB: 0.07 },
    ]
  );
  body.add(torso);
  // мышечные массивы плеча и бедра — рельеф корпуса
  for (const s of [-1, 1]) {
    const sh = addMesh(body, new THREE.SphereGeometry(1, 12, 10), M.coat, s * 0.13, 1.05, -0.44);
    sh.scale.set(0.095, 0.16, 0.14);
    const th = addMesh(body, new THREE.SphereGeometry(1, 12, 10), M.coat, s * 0.14, 1.04, 0.5);
    th.scale.set(0.11, 0.19, 0.17);
  }
  const chestMark = addMesh(body, new THREE.SphereGeometry(1, 12, 10), M.coatLight, 0, 1.08, -0.62);
  chestMark.scale.set(0.11, 0.18, 0.065);

  // ---------- ШЕЯ
  const neck = new THREE.Group();
  neck.position.set(0, 1.18, -0.58);
  neck.rotation.x = -0.6;
  body.add(neck);
  const neckLoft = makeLoft(
    [
      new THREE.Vector3(0, -0.08, 0.03),
      new THREE.Vector3(0, 0.22, 0.02),
      new THREE.Vector3(0, 0.46, 0),
      new THREE.Vector3(0, 0.62, -0.01),
    ],
    [
      { t: 0.0, rx: 0.13, ryT: 0.15, ryB: 0.18 },
      { t: 0.5, rx: 0.095, ryT: 0.11, ryB: 0.12 },
      { t: 1.0, rx: 0.08, ryT: 0.09, ryB: 0.095 },
    ],
    { rings: 24, upStrength: 0.2, downStrength: 0.4 }
  );
  neck.add(neckLoft);
  const collar = addMesh(neck, new THREE.TorusGeometry(0.135, 0.022, 8, 24), M.ornRed, 0, 0.08, 0);
  collar.rotation.x = Math.PI / 2;
  addMesh(collar, new THREE.SphereGeometry(0.035, 8, 6), M.gold, 0, -0.16, 0.015);

  // ---------- ГОЛОВА: клин от мочки носа к черепу
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.02);
  head.rotation.x = 0.45;
  neck.add(head);
  const headLoft = makeLoft(
    [
      new THREE.Vector3(0, -0.035, -0.36),
      new THREE.Vector3(0, -0.02, -0.25),
      new THREE.Vector3(0, 0.005, -0.13),
      new THREE.Vector3(0, 0.025, -0.02),
      new THREE.Vector3(0, 0.02, 0.14),
    ],
    [
      { t: 0.0, rx: 0.042, ryT: 0.035, ryB: 0.04 },
      { t: 0.3, rx: 0.06, ryT: 0.052, ryB: 0.058 },
      { t: 0.55, rx: 0.082, ryT: 0.072, ryB: 0.08 },
      { t: 0.8, rx: 0.11, ryT: 0.1, ryB: 0.105 },
      { t: 1.0, rx: 0.095, ryT: 0.09, ryB: 0.1 },
    ],
    { rings: 28, upStrength: 0.35, downStrength: 0.55 }
  );
  head.add(headLoft);
  addMesh(head, new THREE.SphereGeometry(0.045, 10, 8), M.nose, 0, -0.033, -0.37);
  for (const s of [-1, 1]) {
    const eye = addMesh(head, new THREE.SphereGeometry(0.026, 10, 8), M.eye, s * 0.075, 0.035, -0.08, false);
    eye.scale.set(0.8, 1, 1.2);
  }
  // Уши: висячие, с очёсами — фирменная черта тазы
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.1, 0.07, 0.05);
    ear.rotation.z = s * 0.38;
    head.add(ear);
    const flap = addMesh(ear, new THREE.SphereGeometry(1, 12, 10), M.coatDark, 0, -0.13, 0);
    flap.scale.set(0.055, 0.19, 0.1);
    const fringe = addMesh(ear, new THREE.ConeGeometry(0.06, 0.16, 8), M.coatDark, 0, -0.34, 0);
    fringe.rotation.x = Math.PI;
    ears.push(ear);
  }

  // ---------- ХВОСТ: цельный серповидный очёс без заметных суставов
  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 1.06, 0.74);
  body.add(tailRoot);
  const tail = makeLoft(
    [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.03, -0.08, 0.13),
      new THREE.Vector3(0.08, -0.2, 0.27),
      new THREE.Vector3(0.15, -0.3, 0.41),
      new THREE.Vector3(0.22, -0.28, 0.54),
      new THREE.Vector3(0.2, -0.13, 0.65),
    ],
    [
      { t: 0, rx: 0.03, ryT: 0.026, ryB: 0.038 },
      { t: 0.45, rx: 0.03, ryT: 0.024, ryB: 0.045 },
      { t: 0.8, rx: 0.02, ryT: 0.017, ryB: 0.032 },
      { t: 1, rx: 0.007, ryT: 0.007, ryB: 0.01 },
    ],
    { rings: 32, radialSegments: 10, colorUp: C.coatDark, colorMid: C.coatDark, colorDown: C.coat }
  );
  tailRoot.add(tail);

  // ---------- НОГИ
  function makeLeg(x, z, isFront) {
    const hip = new THREE.Group();
    hip.position.set(x, isFront ? 1.02 : 1.1, z);
    body.add(hip);
    const upperLen = isFront ? 0.42 : 0.48;
    const upper = addMesh(hip, new THREE.CylinderGeometry(0.075, 0.052, upperLen, 10), M.coat, 0, -upperLen / 2, 0);
    if (!isFront) upper.scale.set(1.5, 1, 1.7);
    const knee = new THREE.Group();
    knee.position.set(0, -upperLen, 0);
    hip.add(knee);
    const lowerLen = isFront ? 0.5 : 0.55;
    addMesh(knee, new THREE.SphereGeometry(0.065, 8, 6), M.coat, 0, 0, 0);
    addMesh(knee, new THREE.CylinderGeometry(0.046, 0.032, lowerLen, 8), M.coat, 0, -lowerLen / 2, 0);
    const paw = addMesh(knee, new THREE.SphereGeometry(0.065, 8, 6), M.coat, 0, -lowerLen, -0.025);
    paw.scale.set(1.05, 0.65, 1.55);
    return { hip, knee };
  }
  const legFL = makeLeg(-0.18, -0.52, true);
  const legFR = makeLeg(0.18, -0.52, true);
  const legRL = makeLeg(-0.19, 0.52, false);
  const legRR = makeLeg(0.19, 0.52, false);

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  root.scale.setScalar(1.22);

  // ---------- АНИМАЦИЯ ГАЛОПА
  const legs = [
    { l: legFL, ph: 0.0, front: true },
    { l: legFR, ph: 0.12, front: true },
    { l: legRL, ph: 0.5, front: false },
    { l: legRR, ph: 0.62, front: false },
  ];
  function animate(t, speed, state) {
    const speedNorm = Math.min(1, Math.max(0, (speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
    const cadence = 2.55 + speedNorm * 1.35;
    const T = t * cadence * Math.PI * 2;
    root.rotation.x = -0.025 - speedNorm * 0.035;
    if (state === 'run') {
      const amp = 0.92;
      for (const { l, ph, front } of legs) {
        const p = T + ph * Math.PI * 2;
        const swing = Math.sin(p);
        l.hip.rotation.x = (front ? -1 : 1) * swing * amp * (front ? 1 : 0.92);
        const fold = Math.max(0, Math.sin(p + (front ? 1.25 : 1.05)));
        l.knee.rotation.x = (front ? 1 : -1) * (0.08 + fold * 1.25);
      }
      body.position.y = Math.pow(Math.sin(T), 2) * 0.06 - 0.015;
      body.rotation.x = Math.sin(T) * 0.035;
      tailRoot.rotation.x = Math.sin(T * 0.45) * 0.035;
      tailRoot.rotation.z = Math.sin(T * 0.32) * 0.07;
      for (let i = 0; i < ears.length; i++) {
        ears[i].rotation.x = -0.35 + Math.sin(T * 0.5 + i) * 0.12;
      }
    } else if (state === 'jump') {
      for (const { l, front } of legs) {
        l.hip.rotation.x = front ? -0.9 : 0.85;
        l.knee.rotation.x = front ? 1.5 : -1.4;
      }
      body.rotation.x = -0.18;
      body.position.y = 0;
      tailRoot.rotation.x = -0.08;
      tailRoot.rotation.z = 0.05;
    } else if (state === 'slide') {
      for (const { l, front } of legs) {
        l.hip.rotation.x = front ? -1.25 : 1.2;
        l.knee.rotation.x = front ? 1.9 : -1.7;
      }
      body.rotation.x = 0.12;
      body.position.y = -0.52;
      neck.rotation.x = -1.15;
    }
    if (state !== 'slide') neck.rotation.x = -0.6 + (state === 'run' ? Math.sin(T) * 0.04 : -0.05);
  }
  return { root, body, animate };
}

// ============================================================ СТЕПЬ / ОКРУЖЕНИЕ
function makeSteppeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#c99635'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    g.fillStyle = ['#967126', '#e2b14b', '#7e6825', '#c18329'][i % 4];
    g.beginPath(); g.arc(x, y, 1 + Math.random() * 3.5, 0, 7); g.fill();
  }
  const grad = g.createLinearGradient(140, 0, 372, 0);
  grad.addColorStop(0, 'rgba(110,78,26,0)');
  grad.addColorStop(0.25, 'rgba(105,72,22,0.5)');
  grad.addColorStop(0.5, 'rgba(92,61,18,0.7)');
  grad.addColorStop(0.75, 'rgba(105,72,22,0.5)');
  grad.addColorStop(1, 'rgba(110,78,26,0)');
  g.fillStyle = grad; g.fillRect(140, 0, 232, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const groundTex = makeSteppeTexture();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 260),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -90;
ground.receiveShadow = true;
scene.add(ground);

// Горы на горизонте (Алатау)
{
  const ridge = new THREE.Group();
  for (let i = 0; i < 14; i++) {
    const h = 9 + Math.random() * 14;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(7 + Math.random() * 6, h, 5), mat(C.mountain, { flatShading: true }));
    peak.position.set(-52 + i * 8 + Math.random() * 4, h / 2 - 1.5, -150 - Math.random() * 20);
    ridge.add(peak);
    if (h > 16) {
      const snow = new THREE.Mesh(new THREE.ConeGeometry(2.4, h * 0.28, 5), mat(C.mountainSnow, { flatShading: true }));
      snow.position.set(peak.position.x, h - h * 0.14 - 1.5, peak.position.z + 0.1);
      ridge.add(snow);
    }
  }
  scene.add(ridge);
}

// ---- Орнамент қошқар мүйіз для юрт и арок
function makeYurtOrnamentTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2e4c4'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#8f2020'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 50, 256, 14);
  g.strokeStyle = '#8f2020'; g.lineWidth = 4;
  for (let x = 8; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 44); g.quadraticCurveTo(x + 12, 18, x + 24, 44);
    g.moveTo(x + 4, 40); g.quadraticCurveTo(x + 12, 26, x + 20, 40);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const yurtOrnTex = makeYurtOrnamentTexture();

function makeYurt(scale = 1) {
  const y = new THREE.Group();
  addMesh(y, new THREE.CylinderGeometry(1.5, 1.55, 1.1, 20), M.felt, 0, 0.55, 0);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.52, 1.52, 0.36, 20, 1, true),
    new THREE.MeshStandardMaterial({ map: yurtOrnTex, roughness: 0.9 })
  );
  band.position.y = 0.92; y.add(band);
  addMesh(y, new THREE.SphereGeometry(1.52, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), M.felt, 0, 0.62, 0).scale.set(1, 0.95, 1);
  addMesh(y, new THREE.TorusGeometry(0.3, 0.07, 8, 16), M.wood, 0, 1.98, 0).rotation.x = Math.PI / 2;
  const door = addMesh(y, new THREE.BoxGeometry(0.62, 0.85, 0.08), M.ornRed, 0, 0.45, 1.53);
  addMesh(door, new THREE.BoxGeometry(0.68, 0.1, 0.1), M.gold, 0, 0.46, 0);
  y.scale.setScalar(scale);
  y.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return y;
}

function makeCamel() {
  const c = new THREE.Group();
  const bodyM = addMesh(c, new THREE.SphereGeometry(1, 16, 12), M.camel, 0, 1.35, 0);
  bodyM.scale.set(0.5, 0.55, 1.0);
  for (const hz of [-0.38, 0.34]) {
    const hump = addMesh(c, new THREE.SphereGeometry(0.34, 12, 10), M.camel, 0, 1.95, hz);
    hump.scale.set(0.8, 1, 0.9);
    addMesh(c, new THREE.SphereGeometry(0.15, 8, 6), mat(0x96703c), 0, 2.25, hz);
  }
  const neckC = addMesh(c, new THREE.CylinderGeometry(0.16, 0.22, 1.15, 10), M.camel, 0, 1.95, -0.95);
  neckC.rotation.x = 0.5;
  const headC = addMesh(c, new THREE.SphereGeometry(0.22, 12, 10), M.camel, 0, 2.5, -1.35);
  headC.scale.set(0.8, 0.8, 1.3);
  addMesh(c, new THREE.SphereGeometry(0.06, 6, 6), M.nose, 0, 2.44, -1.62);
  for (const s of [-1, 1]) {
    addMesh(c, new THREE.CylinderGeometry(0.09, 0.07, 1.35, 8), M.camel, s * 0.28, 0.68, -0.55);
    addMesh(c, new THREE.CylinderGeometry(0.09, 0.07, 1.35, 8), M.camel, s * 0.28, 0.68, 0.55);
  }
  const rug = addMesh(c, new THREE.BoxGeometry(1.15, 0.5, 0.9), M.ornRed, 0, 1.5, -0.02);
  addMesh(rug, new THREE.BoxGeometry(1.2, 0.12, 0.95), M.gold, 0, -0.15, 0);
  c.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return c;
}

function makeCart() {
  const c = new THREE.Group();
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 1.1), M.wood, 0, 1.0, 0);
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 0.12), M.wood, 0, 1.35, -0.55);
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 0.12), M.wood, 0, 1.35, 0.55);
  for (const s of [-1, 1]) {
    const wheel = addMesh(c, new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14), M.wood, s * 0.92, 0.55, 0);
    wheel.rotation.z = Math.PI / 2;
  }
  const bale = addMesh(c, new THREE.SphereGeometry(0.45, 10, 8), M.felt, 0, 1.55, 0);
  bale.scale.set(1.4, 0.9, 1);
  addMesh(bale, new THREE.TorusGeometry(0.46, 0.03, 6, 16), M.gold, 0, 0, 0).rotation.x = Math.PI / 2;
  c.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return c;
}

// Низкий плетень (перепрыгнуть) — с ковриком-акцентом, чтобы читался издалека
function makeFence() {
  const f = new THREE.Group();
  for (const x of [-0.8, 0, 0.8]) addMesh(f, new THREE.CylinderGeometry(0.05, 0.06, 0.85, 8), M.wood, x, 0.42, 0);
  addMesh(f, new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8), M.wood, 0, 0.72, 0).rotation.z = Math.PI / 2;
  addMesh(f, new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8), M.wood, 0, 0.42, 0).rotation.z = Math.PI / 2;
  const rug = addMesh(f, new THREE.BoxGeometry(0.7, 0.4, 0.06), M.ornRed, -0.45, 0.55, 0.03);
  rug.rotation.x = 0.15;
  f.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return f;
}

// Арка с тканью (проскользить)
function makeArch() {
  const a = new THREE.Group();
  for (const s of [-1, 1]) addMesh(a, new THREE.CylinderGeometry(0.08, 0.1, 2.3, 10), M.wood, s * 1.05, 1.15, 0);
  const clothTex = yurtOrnTex.clone();
  clothTex.repeat.set(2, 1);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 0.1), new THREE.MeshStandardMaterial({ map: clothTex }));
  cloth.position.y = 1.75; cloth.castShadow = true;
  a.add(cloth);
  addMesh(a, new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8), M.gold, 0, 2.22, 0).rotation.z = Math.PI / 2;
  a.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return a;
}

function makeBalbal() {
  const b = new THREE.Group();
  addMesh(b, new THREE.CylinderGeometry(0.32, 0.42, 1.7, 8), M.stone, 0, 0.85, 0);
  addMesh(b, new THREE.SphereGeometry(0.3, 10, 8), M.stone, 0, 1.8, 0).scale.set(1, 1.15, 0.9);
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return b;
}

function makeBush() {
  const b = new THREE.Group();
  addMesh(b, new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6), M.wood, 0, 0.35, 0);
  for (let i = 0; i < 3; i++) {
    addMesh(b, new THREE.SphereGeometry(0.35 + Math.random() * 0.2, 8, 6),
      mat(i === 0 ? 0x477f2c : 0x659b35, { flatShading: true }), (Math.random() - 0.5) * 0.5, 0.85 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
  }
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return b;
}

function makeAsyk() {
  const g = new THREE.Group();
  const core = addMesh(g, new THREE.DodecahedronGeometry(0.24, 0), M.gold, 0, 0, 0);
  core.scale.set(0.85, 1.15, 0.7);
  return g;
}

// Беркут в небе
const eagle = new THREE.Group();
{
  const eb = addMesh(eagle, new THREE.SphereGeometry(0.25, 8, 6), mat(0x3a2a18), 0, 0, 0);
  eb.scale.set(0.7, 0.5, 1.4);
  for (const s of [-1, 1]) {
    const wing = addMesh(eagle, new THREE.BoxGeometry(1.6, 0.06, 0.5), mat(0x3a2a18), s * 0.9, 0.1, 0);
    wing.rotation.z = s * 0.15;
  }
  eagle.position.set(6, 14, -60);
  scene.add(eagle);
}

// ---- Скальные стены каньона (Чарын): «коридор скорости»
const rockMats = [
  mat(0xc47a48, { flatShading: true, roughness: 0.95 }),
  mat(0xb06a3e, { flatShading: true, roughness: 0.95 }),
  mat(0xd28c55, { flatShading: true, roughness: 0.95 }),
  mat(0x9a5a34, { flatShading: true, roughness: 0.95 }),
];
function makeCliff() {
  const g = new THREE.Group();
  const h = 2.2 + Math.random() * 2.8;
  let y = 0;
  const layers = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < layers; i++) {
    const lh = h / layers * (0.8 + Math.random() * 0.5);
    const w = (2.6 - i * 0.45) * (0.85 + Math.random() * 0.3);
    const d = 3.2 + Math.random() * 1.5;
    const rock = addMesh(g, new THREE.DodecahedronGeometry(1, 0), rockMats[(Math.random() * rockMats.length) | 0], (Math.random() - 0.5) * 0.4, y + lh / 2, (Math.random() - 0.5) * 0.6);
    rock.scale.set(w / 2, lh / 2 * 1.4, d / 2);
    rock.rotation.y = Math.random() * Math.PI;
    y += lh * 0.72;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makePoplar() {
  const g = new THREE.Group();
  addMesh(g, new THREE.CylinderGeometry(0.09, 0.13, 1.1, 7), M.wood, 0, 0.55, 0);
  addMesh(g, new THREE.ConeGeometry(0.75, 3.6, 8), mat(0x28652f, { flatShading: true }), 0, 2.6, 0);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---- Пыль из-под лап
const dustPool = [];
{
  const dustMat = new THREE.MeshBasicMaterial({ color: 0x9c8a55, transparent: true, opacity: 0.35, depthWrite: false });
  for (let i = 0; i < 24; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), dustMat.clone());
    p.visible = false;
    p.userData.life = 0;
    scene.add(p);
    dustPool.push(p);
  }
}
let dustTimer = 0;
function spawnDust(x, z, big = false) {
  const p = dustPool.find(d => !d.visible);
  if (!p) return;
  p.visible = true;
  p.userData.life = 1;
  p.position.set(x + (Math.random() - 0.5) * 0.7, 0.04, z + 0.4 + Math.random() * 0.5);
  const s = (0.35 + Math.random() * 0.45) * (big ? 2 : 1);
  p.scale.set(s * 1.4, s * 0.6, s * 1.4);
}
function updateDust(dt, dz) {
  for (const p of dustPool) {
    if (!p.visible) continue;
    p.userData.life -= dt * 2.8;
    if (p.userData.life <= 0) { p.visible = false; continue; }
    p.position.z += dz;
    p.position.y += dt * 0.5;
    p.scale.multiplyScalar(1 + dt * 3.2);
    p.material.opacity = 0.35 * p.userData.life * p.userData.life;
  }
}

// ============================================================ ИГРОВОЕ СОСТОЯНИЕ
const tazy = createTazy();
scene.add(tazy.root);

const game = {
  running: false,
  speed: 0,
  t: 0,
  lane: 1,
  laneX: 0, laneFrom: 0, laneT: 1, // твин смены полосы
  y: 0, vy: 0, jumpHeld: false, jumpPeak: 0, lastJumpPeak: 0,
  state: 'run',
  slideTimer: 0,
  queued: null,     // буфер ввода в воздухе
  landSquash: 0,
  score: 0, asyks: 0,
  best: +(localStorage.getItem('tazy-best') || 0),
  distSinceObstacle: 0, distSinceDecor: 0,
  distSinceWallL: 0, distSinceWallR: 0, distSinceTrackside: 0,
  deathShake: 0,
};

const obstacles = []; // {group, kind, lane}
const decors = [];
const coins = [];
const patternDirector = { safeLane: 1, lastId: '', lastWasAction: false, history: [] };

function spawnDecor() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const kind = Math.random();
  let obj, x;
  if (kind < 0.3) { obj = makeYurt(1.6 + Math.random()); x = side * (10 + Math.random() * 12); }
  else if (kind < 0.45) { obj = makeBalbal(); x = side * (8 + Math.random() * 8); }
  else { obj = makeBush(); x = side * (8 + Math.random() * 12); }
  obj.position.set(x, 0, SPAWN_Z - Math.random() * 20);
  obj.rotation.y = Math.random() * Math.PI * 2;
  scene.add(obj);
  decors.push(obj);
}

function spawnWall(side, z = SPAWN_Z - Math.random() * 4) {
  const obj = Math.random() < 0.82 ? makeCliff() : makePoplar();
  obj.position.set(side * (6.3 + Math.random() * 1.4), 0, z);
  scene.add(obj);
  decors.push(obj);
}

function spawnTrackside() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const obj = new THREE.Group();
  if (Math.random() < 0.6) {
    const tuft = addMesh(obj, new THREE.SphereGeometry(0.14 + Math.random() * 0.12, 7, 5),
      mat(0x5f8f32, { flatShading: true }), 0, 0.08, 0);
    tuft.scale.y = 0.6;
  } else {
    addMesh(obj, new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.14, 0), M.stone, 0, 0.1, 0);
  }
  obj.position.set(side * (3.4 + Math.random() * 1.8), 0, SPAWN_Z - Math.random() * 8);
  obj.rotation.y = Math.random() * Math.PI * 2;
  scene.add(obj);
  decors.push(obj);
}

// ============================================================ ГЕНЕРАЦИЯ ПРЕПЯТСТВИЙ — ПАТТЕРНЫ
// Правила честного раннера: всегда есть проходимая полоса; монеты
// подсказывают правильный путь; дистанция между волнами — по времени
// реакции, а не по метрам.
const KIND_FENCE = 'jump', KIND_ARCH = 'slide', KIND_BLOCK = 'block';
const BLOCK_MAKERS = [makeCamel, makeCart, () => makeYurt(0.85)];

function addObstacle(lane, kind, zOff = 0) {
  let grp;
  if (kind === KIND_FENCE) grp = makeFence();
  else if (kind === KIND_ARCH) grp = makeArch();
  else grp = BLOCK_MAKERS[(Math.random() * BLOCK_MAKERS.length) | 0]();
  grp.position.set(LANE_X[lane], 0, SPAWN_Z + zOff);
  scene.add(grp);
  obstacles.push({ group: grp, kind, lane });
}
function addCoin(lane, y, zOff) {
  const a = makeAsyk();
  a.position.set(LANE_X[lane], y, SPAWN_Z + zOff);
  scene.add(a);
  coins.push(a);
}
function coinLine(lane, zOff, n = 5, y = 0.85) {
  for (let i = 0; i < n; i++) addCoin(lane, y, zOff - i * 1.7);
}
function coinArc(lane, zOff) { // дуга над прыжковым препятствием
  for (let i = -2; i <= 2; i++) addCoin(lane, 1.05 + Math.cos(i * 0.55) * 1.0, zOff + i * 1.1);
}

const otherLanes = (l) => [0, 1, 2].filter(x => x !== l);
const adjacentLane = (lane) => {
  if (lane === 0) return 1;
  if (lane === 2) return 1;
  return Math.random() < 0.5 ? 0 : 2;
};
function addGate(freeLane, zOff = 0, kind = KIND_BLOCK) {
  for (const lane of otherLanes(freeLane)) addObstacle(lane, kind, zOff);
}
function addActionRow(kind, zOff = 0) {
  for (let lane = 0; lane < 3; lane++) addObstacle(lane, kind, zOff);
}

// Паттерны хранят непрерывный безопасный маршрут. Ранние волны обучают
// одному действию, поздние соединяют два заранее читаемых решения.
const PATTERNS = [
  { id: 'coin-run', minTier: 0, w: 2, gen(safe) {
    coinLine(safe, 2, 7);
    return { depth: 12, safeLane: safe };
  }},
  { id: 'lane-change', minTier: 0, w: 5, gen(safe) {
    const target = adjacentLane(safe);
    addObstacle(safe, KIND_BLOCK);
    coinLine(target, 2, 6);
    return { depth: 11, safeLane: target };
  }},
  { id: 'jump-teach', minTier: 0, w: 4, gen(safe) {
    addObstacle(safe, KIND_FENCE);
    coinArc(safe, 0);
    return { depth: 8, safeLane: safe };
  }},
  { id: 'slide-teach', minTier: 0.08, w: 4, gen(safe) {
    addObstacle(safe, KIND_ARCH);
    coinLine(safe, 3, 5, 0.58);
    return { depth: 9, safeLane: safe };
  }},
  { id: 'open-gate', minTier: 0.12, w: 5, gen(safe) {
    const free = Math.random() < 0.45 ? safe : adjacentLane(safe);
    addGate(free);
    coinLine(free, 2, 5);
    return { depth: 10, safeLane: free };
  }},
  { id: 'zigzag-gates', minTier: 0.28, w: 3, gen(safe) {
    const first = adjacentLane(safe);
    const second = adjacentLane(first);
    addGate(first, 0);
    addGate(second, -15);
    coinLine(first, 3, 4);
    coinLine(second, -11, 5);
    return { depth: 22, safeLane: second, route: [first, second] };
  }},
  { id: 'jump-row', minTier: 0.38, w: 2.5, action: true, gen(safe) {
    addActionRow(KIND_FENCE);
    coinArc(safe, 0);
    return { depth: 9, safeLane: safe };
  }},
  { id: 'slide-row', minTier: 0.48, w: 2.5, action: true, gen(safe) {
    addActionRow(KIND_ARCH);
    coinLine(safe, 3, 5, 0.58);
    return { depth: 10, safeLane: safe };
  }},
  { id: 'switch-then-jump', minTier: 0.58, w: 3, gen(safe) {
    const target = adjacentLane(safe);
    addGate(target, 0);
    addObstacle(target, KIND_FENCE, -14);
    coinLine(target, 3, 4);
    coinArc(target, -14);
    return { depth: 21, safeLane: target };
  }},
];

function spawnPattern() {
  const tier = Math.min(1, game.t / 95);
  let pool = PATTERNS.filter(p => tier >= p.minTier && p.id !== patternDirector.lastId && !(p.action && patternDirector.lastWasAction));
  if (!pool.length) pool = PATTERNS.filter(p => tier >= p.minTier);
  let sum = 0; for (const p of pool) sum += p.w;
  let r = Math.random() * sum;
  let chosen = pool[0];
  for (const p of pool) { r -= p.w; if (r <= 0) { chosen = p; break; } }
  const fromLane = patternDirector.safeLane;
  const result = chosen.gen(fromLane, tier);
  patternDirector.safeLane = result.safeLane;
  patternDirector.lastId = chosen.id;
  patternDirector.lastWasAction = Boolean(chosen.action);
  patternDirector.history.push({
    id: chosen.id,
    fromLane,
    safeLane: result.safeLane,
    route: result.route || [result.safeLane],
    action: Boolean(chosen.action),
  });
  if (patternDirector.history.length > 24) patternDirector.history.shift();
  return result.depth;
}

// ============================================================ ЗВУК
// Кюй-мотив: ре-минорная пентатоника, ровный пульс, тихий бас-бурдон.
// Всё синтезируется на WebAudio — ни одного аудиофайла.
const audio = { ctx: null, muted: false, master: null, nextStep: 0, step: 0 };
function ac() {
  if (!audio.ctx) {
    audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 1;
    const lp = audio.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    audio.master.connect(lp).connect(audio.ctx.destination);
  }
  return audio.ctx;
}
function tone(freq, { vol = 0.1, dur = 0.4, type = 'triangle', when = 0 } = {}) {
  if (audio.muted) return;
  const ctx = ac();
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(audio.master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
// D минорная пентатоника: D F G A C
const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25];
const D3 = 146.83;
// 32 шага (2 такта), -1 = пауза; мелодия с опорой на тонику, как в кюях
const MELODY = [
  0, -1, 1, 2, -1, 2, 1, 0, -1, 0, 2, -1, 3, 2, 1, -1,
  0, -1, 1, 2, -1, 3, 4, 3, -1, 2, 1, 2, 0, -1, 0, -1,
];
const STEP_DUR = 0.21; // ~143 удара при восьмых — живой темп
function scheduleMusic() {
  if (audio.muted || !audio.ctx || !game.running) return;
  const ctx = audio.ctx;
  while (audio.nextStep < ctx.currentTime + 0.15) {
    const i = audio.step % MELODY.length;
    const n = MELODY[i];
    const when = audio.nextStep - ctx.currentTime;
    if (n >= 0) tone(SCALE[n], { vol: 0.028, dur: 0.3, type: 'triangle', when });
    if (i % 8 === 0) tone(D3, { vol: 0.035, dur: 0.5, type: 'sine', when }); // бурдон
    if (i % 8 === 4) tone(D3 * 1.5, { vol: 0.02, dur: 0.35, type: 'sine', when });
    audio.nextStep += STEP_DUR;
    audio.step++;
  }
}
function sfxCoin() { tone(1174.7, { vol: 0.07, dur: 0.12, type: 'sine' }); tone(1568, { vol: 0.05, dur: 0.2, type: 'sine', when: 0.05 }); }
function sfxJump() { tone(300, { vol: 0.06, dur: 0.18 }); tone(430, { vol: 0.05, dur: 0.15, when: 0.05 }); }
function sfxSlide() { tone(220, { vol: 0.05, dur: 0.2, type: 'sawtooth' }); }
function sfxHit() {
  if (audio.muted) return;
  const ctx = ac();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(160, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
  g.gain.setValueAtTime(0.2, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
  o.connect(g).connect(audio.master);
  o.start(); o.stop(ctx.currentTime + 0.6);
}
document.getElementById('mute-btn').addEventListener('click', (e) => {
  audio.muted = !audio.muted;
  e.target.textContent = audio.muted ? '🔇' : '🔊';
  if (!audio.muted && audio.ctx) audio.nextStep = audio.ctx.currentTime + 0.1;
});

// ============================================================ УПРАВЛЕНИЕ
function moveLane(dir) {
  if (!game.running) return;
  const target = Math.max(0, Math.min(2, game.lane + dir));
  if (target === game.lane) return;
  game.laneFrom = game.laneX;
  game.lane = target;
  game.laneT = 0;
}
function doJump() {
  if (!game.running) return;
  if (game.state === 'jump') {
    if (game.vy < 0 && game.y < 0.42) game.queued = 'jump';
    return;
  }
  game.state = 'jump';
  game.vy = JUMP_VY;
  game.jumpHeld = true;
  game.jumpPeak = 0;
  sfxJump();
  spawnDust(game.laneX, 0, true);
}
function releaseJump() {
  game.jumpHeld = false;
  if (game.state === 'jump' && game.vy > JUMP_CUT_VY) game.vy = JUMP_CUT_VY;
}
function doSlide() {
  if (!game.running) return;
  if (game.state === 'jump') { game.jumpHeld = false; game.vy = FASTFALL_VY; game.queued = 'slide'; return; }
  game.state = 'slide';
  game.slideTimer = SLIDE_TIME;
  sfxSlide();
  spawnDust(game.laneX, 0, true);
}
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') moveLane(-1);
  else if (e.key === 'ArrowRight' || e.key === 'd') moveLane(1);
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') doJump();
  else if (e.key === 'ArrowDown' || e.key === 's') doSlide();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') releaseJump();
});
let touchStart = null;
let suppressTapClick = false;
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  suppressTapClick = false;
  touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  if (event.isTrusted) canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointerup', (event) => {
  if (!touchStart || event.pointerId !== touchStart.id) return;
  event.preventDefault();
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { doJump(); return; }
  suppressTapClick = true;
  if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) doJump(); else doSlide();
});
canvas.addEventListener('pointercancel', () => { touchStart = null; });
canvas.addEventListener('click', () => {
  if (suppressTapClick) { suppressTapClick = false; return; }
  doJump();
});

// ============================================================ UI
const $ = id => document.getElementById(id);
const scoreEl = $('score'), asykEl = $('asyk-count'), bestEl = $('best');
const startOverlay = $('start-overlay'), gameoverOverlay = $('gameover-overlay');
const countdownEl = $('countdown'), flashEl = $('flash'), popupsEl = $('popups');

function popup(text) {
  const d = document.createElement('div');
  d.className = 'popup';
  d.textContent = text;
  d.style.left = (50 + (Math.random() - 0.5) * 14) + '%';
  popupsEl.appendChild(d);
  setTimeout(() => d.remove(), 800);
}
function pulseAsyk() {
  asykEl.classList.remove('pulse');
  void asykEl.offsetWidth; // рестарт css-анимации
  asykEl.classList.add('pulse');
}

function startGame() {
  for (const o of obstacles) scene.remove(o.group);
  for (const d of decors) scene.remove(d);
  for (const c of coins) scene.remove(c);
  obstacles.length = decors.length = coins.length = 0;
  Object.assign(game, {
    running: true, speed: 0, t: 0, lane: 1, laneX: 0, laneFrom: 0, laneT: 1,
    y: 0, vy: 0, jumpHeld: false, jumpPeak: 0, lastJumpPeak: 0, state: 'run', slideTimer: 0, queued: null, landSquash: 0,
    score: 0, asyks: 0,
    distSinceObstacle: -14, distSinceDecor: 0,
    distSinceWallL: 0, distSinceWallR: 0, distSinceTrackside: 0,
    deathShake: 0,
  });
  Object.assign(patternDirector, { safeLane: 1, lastId: '', lastWasAction: false });
  patternDirector.history.length = 0;
  for (let i = 0; i < 10; i++) { spawnDecor(); decors[decors.length - 1].position.z = -10 - i * 10; }
  for (let z = -6; z > SPAWN_Z; z -= 4.5) {
    spawnWall(-1, z - Math.random() * 2);
    spawnWall(1, z - Math.random() * 2);
  }
  startOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  bestEl.textContent = `Рекорд ${game.best}`;
  const ctx = ac();
  ctx.resume?.();
  audio.nextStep = ctx.currentTime + COUNTDOWN;
  audio.step = 0;
  // отсчёт
  const seq = [['3', 0], ['2', 600], ['1', 1200], ['Алға!', 1800]];
  countdownEl.classList.remove('hidden');
  for (const [txt, ms] of seq) {
    setTimeout(() => {
      if (!game.running) return;
      countdownEl.textContent = txt;
      countdownEl.classList.remove('pop');
      void countdownEl.offsetWidth;
      countdownEl.classList.add('pop');
      if (txt !== 'Алға!') tone(440, { vol: 0.05, dur: 0.15 });
      else tone(880, { vol: 0.07, dur: 0.3 });
    }, ms);
  }
  setTimeout(() => countdownEl.classList.add('hidden'), 2500);
  lastTime = performance.now();
}
function gameOver() {
  game.running = false;
  game.deathShake = 0.45;
  sfxHit();
  flashEl.classList.remove('go');
  void flashEl.offsetWidth;
  flashEl.classList.add('go');
  const score = Math.floor(game.score);
  const isRecord = score > game.best;
  game.best = Math.max(score, game.best);
  localStorage.setItem('tazy-best', game.best);
  $('final-stats').textContent = `Ұпай: ${score} · Асық: ${game.asyks}`;
  $('best-line').textContent = isRecord ? '🏆 Жаңа рекорд!' : `Рекорд: ${game.best}`;
  setTimeout(() => gameoverOverlay.classList.remove('hidden'), 700);
}
$('start-btn').addEventListener('click', startGame);
$('restart-btn').addEventListener('click', startGame);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !game.running) startGame();
});

// ============================================================ ГЛАВНЫЙ ЦИКЛ
let lastTime = performance.now();
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
const smoothstep = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const t = now / 1000;

  // беркут кружит всегда
  eagle.position.x = Math.sin(t * 0.14) * 22;
  eagle.position.z = -55 + Math.cos(t * 0.14) * 14;
  eagle.rotation.y = t * 0.14 + Math.PI / 2;
  eagle.children.forEach((w, i) => { if (i > 0) w.rotation.z = (i === 1 ? -1 : 1) * (0.15 + Math.sin(t * 6) * 0.3); });

  if (game.running) {
    game.t += dt;
    // плавный разгон после отсчёта
    const target = Math.min(MAX_SPEED, START_SPEED + Math.max(0, game.t - COUNTDOWN) * 0.28);
    game.speed = target * smoothstep((game.t - COUNTDOWN * 0.55) / 1.6);
    const dz = game.speed * dt;
    game.score += dz * 0.6;

    // --- смена полосы: быстрый ease-out твин
    if (game.laneT < 1) {
      game.laneT = Math.min(1, game.laneT + dt / LANE_TWEEN);
      game.laneX = game.laneFrom + (LANE_X[game.lane] - game.laneFrom) * easeOutCubic(game.laneT);
    } else {
      game.laneX = LANE_X[game.lane];
    }

    // --- вертикаль: прыжок / подкат
    if (game.state === 'jump') {
      game.vy += GRAVITY * dt;
      game.y += game.vy * dt;
      game.jumpPeak = Math.max(game.jumpPeak, game.y);
      if (game.y <= 0) {
        game.lastJumpPeak = game.jumpPeak;
        game.y = 0; game.vy = 0; game.state = 'run';
        game.landSquash = 0.12;
        spawnDust(game.laneX, 0, true);
        // буфер ввода: выполняем то, что нажали в воздухе
        if (game.queued === 'slide') { game.queued = null; doSlide(); }
        else if (game.queued === 'jump') { game.queued = null; doJump(); }
        game.queued = null;
      }
    } else if (game.state === 'slide') {
      game.slideTimer -= dt;
      if (game.slideTimer <= 0) game.state = 'run';
    }
    game.landSquash = Math.max(0, game.landSquash - dt);

    tazy.root.position.set(game.laneX, game.y, 0);
    // крен в сторону манёвра — читается мгновенно
    const lean = game.laneT < 1 ? (LANE_X[game.lane] - game.laneFrom) * (1 - game.laneT) * -0.22 : 0;
    tazy.root.rotation.z = lean;
    tazy.body.scale.y = 1 - (game.landSquash / 0.12) * 0.14;
    tazy.animate(game.t, game.speed, game.state);

    // --- пыль
    if (game.state !== 'jump' && game.speed > 2) {
      dustTimer -= dt;
      if (dustTimer <= 0) { dustTimer = 0.9 / game.speed; spawnDust(game.laneX, 0); }
    }
    updateDust(dt, dz);

    // --- прокрутка мира (тайл текстуры = 260/24 юнита)
    groundTex.offset.y -= dz * (24 / 260);
    for (const o of obstacles) o.group.position.z += dz;
    for (const d of decors) d.position.z += dz;
    for (const c of coins) { c.position.z += dz; c.rotation.y += dt * 5; c.position.y += Math.sin(t * 6 + c.position.z) * dt * 0.12; }

    // --- спавн: волны по времени реакции
    game.distSinceObstacle += dz;
    game.distSinceDecor += dz;
    game.distSinceTrackside += dz;
    game.distSinceWallL += dz;
    game.distSinceWallR += dz;
    const tier = Math.min(1, game.t / 95);
    const reactionTime = 1.65 - tier * 0.5;
    const gap = Math.max(20, game.speed * reactionTime) * (0.94 + Math.random() * 0.12);
    if (game.speed > 6 && game.distSinceObstacle > gap) {
      game.distSinceObstacle = -spawnPattern();
    }
    if (game.distSinceDecor > 9) { game.distSinceDecor = 0; spawnDecor(); }
    if (game.distSinceTrackside > 3.5) { game.distSinceTrackside = 0; spawnTrackside(); }
    if (game.distSinceWallL > 4.5) { game.distSinceWallL = Math.random() * 1.5; spawnWall(-1); }
    if (game.distSinceWallR > 4.5) { game.distSinceWallR = Math.random() * 1.5; spawnWall(1); }

    // --- коллизии
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (o.group.position.z > KILL_Z) { scene.remove(o.group); obstacles.splice(i, 1); continue; }
      if (Math.abs(o.group.position.z) < 0.9 && o.lane === game.lane && game.laneT > 0.55) {
        const clear =
          (o.kind === 'jump' && game.y > 0.5) ||
          (o.kind === 'slide' && game.state === 'slide');
        if (!clear) { gameOver(); break; }
      }
    }
    // --- асыки: лёгкий магнит + сбор
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (c.position.z > KILL_Z) { scene.remove(c); coins.splice(i, 1); continue; }
      const dy = c.position.y - (0.85 + game.y);
      const dx = c.position.x - game.laneX;
      if (Math.abs(c.position.z) < 2.6 && Math.abs(dx) < 1.4 && Math.abs(dy) < 1.4) {
        // магнит: подтягиваем к собаке
        c.position.x -= dx * dt * 9;
        c.position.y -= dy * dt * 9;
      }
      if (Math.abs(c.position.z) < 0.9 && Math.abs(dx) < 0.9 && Math.abs(dy) < 1.0) {
        scene.remove(c); coins.splice(i, 1);
        game.asyks++; game.score += 15;
        sfxCoin();
        popup('+15');
        pulseAsyk();
      }
    }
    for (let i = decors.length - 1; i >= 0; i--) {
      if (decors[i].position.z > KILL_Z + 10) { scene.remove(decors[i]); decors.splice(i, 1); }
    }

    // --- камера: плавный переезд в игровую позицию, FOV-разгон
    camera.position.x += (game.laneX * 0.45 + CAM.xOffset - camera.position.x) * dt * 4;
    camera.position.y += (CAM.y + Math.sin(game.t * 2.2) * 0.03 - camera.position.y) * dt * 3;
    camera.position.z += (CAM.z - camera.position.z) * dt * 3;
    const speedZoom = Math.min(1, Math.max(0, (game.speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
    const targetFov = 56 + speedZoom * 8;
    camera.fov += (targetFov - camera.fov) * dt * 2;
    camera.updateProjectionMatrix();
    camera.lookAt(game.laneX * 0.6, CAM.lookY, CAM.lookZ);

    scheduleMusic();

    scoreEl.textContent = Math.floor(game.score);
    asykEl.textContent = game.asyks;
  } else {
    // на заставке собака трусит на месте
    tazy.animate(t, 7, 'run');
    tazy.root.rotation.z = 0;
    tazy.body.scale.y = 1;
    if (DEBUG_DOG) {
      camera.position.set(3.4, 1.15, -0.1); // осмотр модели строго сбоку
      camera.lookAt(0, 0.9, 0);
    } else {
      camera.position.x += (Math.sin(t * 0.25) * 1.2 - camera.position.x) * dt * 2;
      camera.position.y += (3.4 - camera.position.y) * dt * 2;
      camera.position.z += (7.2 - camera.position.z) * dt * 2;
      camera.lookAt(0, 1.0, -3);
    }
  }

  // встряска камеры при смерти
  if (game.deathShake > 0) {
    game.deathShake -= dt;
    const s = game.deathShake / 0.45;
    camera.position.x += (Math.random() - 0.5) * 0.3 * s;
    camera.position.y += (Math.random() - 0.5) * 0.25 * s;
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
window.__tazyGame = {
  get snapshot() {
    return {
      running: game.running,
      state: game.state,
      y: game.y,
      vy: game.vy,
      speed: game.speed,
      lane: game.lane,
      lastJumpPeak: game.lastJumpPeak,
      patterns: patternDirector.history.map(pattern => ({ ...pattern })),
    };
  },
  samplePatterns(count = 16, tier = 1) {
    const previousTime = game.t;
    game.t = Math.max(0, Math.min(1, tier)) * 95;
    Object.assign(patternDirector, { safeLane: 1, lastId: '', lastWasAction: false });
    patternDirector.history.length = 0;
    for (let i = 0; i < count; i++) spawnPattern();
    game.t = previousTime;
    return patternDirector.history.map(pattern => ({ ...pattern }));
  },
};
if (DEBUG_DOG) window.__dbg = { scene, game, tazy, camera };

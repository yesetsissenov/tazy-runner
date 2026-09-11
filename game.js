// ТАЗЫ RUNNER — endless runner в казахском стиле
// Герой: тазы (казахская борзая), процедурная 3D-модель + анимация галопа
import * as THREE from 'three';

// ============================================================ CONSTANTS
const LANE_X = [-2.3, 0, 2.3];
const SPAWN_Z = -110;
const KILL_Z = 14;
const GRAVITY = -34;
const JUMP_VY = 12.5;
const SLIDE_TIME = 0.62;
const START_SPEED = 13;
const MAX_SPEED = 30;
const DEBUG_DOG = new URLSearchParams(location.search).get('debug') === 'dog';

// Палитра тазы: золотисто-палевый окрас (самый типичный)
const C = {
  coat: 0xc99a52,      // основной палевый
  coatLight: 0xe0bf8a, // грудь/низ
  coatDark: 0x8a6432,  // уши, спина-маска
  nose: 0x1c1410,
  steppe: 0xb5a15e,
  mountain: 0x7d6b8f,
  mountainSnow: 0xf0ead8,
  felt: 0xe8dcc0,      // войлок юрты
  ornRed: 0x7a1f1f,
  gold: 0xd4a017,
  wood: 0x6e4a26,
};

// ============================================================ RENDERER / SCENE
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe8cfa0, 45, 105);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 300);
camera.position.set(0, 3.4, 7.2);
camera.lookAt(0, 1.1, -4);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- Sky: gradient canvas texture
{
  const cv = document.createElement('canvas');
  cv.width = 2; cv.height = 256;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3e7bc4');
  gr.addColorStop(0.55, '#9dc0e0');
  gr.addColorStop(0.8, '#e8cfa0');
  gr.addColorStop(1, '#e0b878');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
}

// ---- Lights
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x8a7040, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(14, 22, -8);
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
  coatLight: mat(C.coatLight),
  coatDark: mat(C.coatDark, { roughness: 0.75 }),
  nose: mat(C.nose, { roughness: 0.4 }),
  eye: mat(0x241608, { roughness: 0.25, metalness: 0.3 }),
  felt: mat(C.felt, { roughness: 0.95 }),
  ornRed: mat(C.ornRed),
  gold: mat(C.gold, { roughness: 0.35, metalness: 0.55 }),
  wood: mat(C.wood, { roughness: 0.9 }),
  camel: mat(0xb08850),
  stone: mat(0x8f8578, { roughness: 0.95 }),
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
// stations: [{t, rx, ryT, ryB}] — полуширина, полувысота вверх и вниз от хребта.
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
    const s = k * k * (3 - 2 * k); // smoothstep
    const L = (x, y) => x + (y - x) * s;
    return { rx: L(a.rx, b.rx), ryT: L(a.ryT, b.ryT), ryB: L(a.ryB, b.ryB) };
  };
  const pos = [], col = [], idx = [];
  const cUp = new THREE.Color(opts.colorUp ?? C.coatDark);
  const cMid = new THREE.Color(opts.colorMid ?? C.coat);
  const cDn = new THREE.Color(opts.colorDown ?? C.coatLight);
  const S = new THREE.Vector3(1, 0, 0); // боковая ось (кривая лежит в плоскости x=0)
  const tmp = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const P = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const U = new THREE.Vector3(0, T.z, -T.y).normalize(); // «верх» сечения
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
      // окрас: спина темнее, брюхо светлее
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
  const root = new THREE.Group();      // позиция на дороге
  const body = new THREE.Group();      // качается при галопе
  root.add(body);

  // ---------- ТУЛОВИЩЕ: единый гладкий лофт от плеч до основания хвоста
  // глубокая грудь → резкий подрыв (талия) → мускулистый круп
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
      { t: 0.0, rx: 0.09, ryT: 0.09, ryB: 0.13 },
      { t: 0.16, rx: 0.145, ryT: 0.15, ryB: 0.3 },  // грудная клетка, самая глубокая точка
      { t: 0.34, rx: 0.135, ryT: 0.14, ryB: 0.26 },
      { t: 0.56, rx: 0.1, ryT: 0.13, ryB: 0.12 },   // подрыв — фирменная «талия» борзой
      { t: 0.78, rx: 0.125, ryT: 0.14, ryB: 0.15 }, // круп
      { t: 1.0, rx: 0.04, ryT: 0.05, ryB: 0.05 },
    ]
  );
  body.add(torso);

  // ---------- ШЕЯ: длинный сухой лофт, овал глубже спереди-сзади
  const neck = new THREE.Group();
  neck.position.set(0, 1.18, -0.58);
  neck.rotation.x = -0.6; // наклон вперёд-вверх (к морде)
  body.add(neck);
  const neckLoft = makeLoft(
    [
      new THREE.Vector3(0, -0.08, 0.03),
      new THREE.Vector3(0, 0.22, 0.02),
      new THREE.Vector3(0, 0.46, 0),
      new THREE.Vector3(0, 0.62, -0.01),
    ],
    [
      { t: 0.0, rx: 0.1, ryT: 0.14, ryB: 0.17 },
      { t: 0.5, rx: 0.072, ryT: 0.1, ryB: 0.11 },
      { t: 1.0, rx: 0.06, ryT: 0.08, ryB: 0.085 },
    ],
    { rings: 24, upStrength: 0.2, downStrength: 0.4 }
  );
  neck.add(neckLoft);

  // ---------- ГОЛОВА: клинообразный лофт от мочки носа к черепу
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.02);
  head.rotation.x = 0.45; // компенсация наклона шеи: морда вперёд, чуть вниз
  neck.add(head);
  const headLoft = makeLoft(
    [
      new THREE.Vector3(0, -0.035, -0.43), // мочка
      new THREE.Vector3(0, -0.02, -0.3),
      new THREE.Vector3(0, 0.005, -0.16),  // переход (stop)
      new THREE.Vector3(0, 0.025, -0.02),
      new THREE.Vector3(0, 0.02, 0.14),    // затылок
    ],
    [
      { t: 0.0, rx: 0.026, ryT: 0.024, ryB: 0.026 },
      { t: 0.3, rx: 0.04, ryT: 0.038, ryB: 0.045 },
      { t: 0.55, rx: 0.065, ryT: 0.06, ryB: 0.065 },
      { t: 0.8, rx: 0.085, ryT: 0.085, ryB: 0.09 },
      { t: 1.0, rx: 0.07, ryT: 0.07, ryB: 0.08 },
    ],
    { rings: 28, upStrength: 0.35, downStrength: 0.55 }
  );
  head.add(headLoft);
  // Мочка носа
  addMesh(head, new THREE.SphereGeometry(0.028, 10, 8), M.nose, 0, -0.033, -0.43);
  // Глаза: тёмные, миндалевидные, по бокам узкой головы
  for (const s of [-1, 1]) {
    const eye = addMesh(head, new THREE.SphereGeometry(0.022, 10, 8), M.eye, s * 0.055, 0.032, -0.11, false);
    eye.scale.set(0.8, 1, 1.2);
  }
  // Уши: висячие, мягкие, с очёсами — фирменная черта тазы
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.085, 0.07, 0.05);
    ear.rotation.z = s * 0.38;
    head.add(ear);
    const flap = addMesh(ear, new THREE.SphereGeometry(1, 12, 10), M.coatDark, 0, -0.13, 0);
    flap.scale.set(0.034, 0.16, 0.085);
    // очёс на конце уха
    const fringe = addMesh(ear, new THREE.ConeGeometry(0.042, 0.1, 8), M.coatDark, 0, -0.3, 0);
    fringe.rotation.x = Math.PI;
    ears.push(ear);
  }

  // ---------- ХВОСТ: длинный, тонкий, серпом вверх на конце
  const tailSegs = [];
  let tailParent = body;
  let tp = new THREE.Vector3(0, 1.06, 0.78);
  const tailCurve = [-0.9, -0.4, -0.3, -0.4, -0.4]; // вниз-назад, кончик серпом вверх
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.copy(tp);
    seg.rotation.x = tailCurve[i];
    tailParent.add(seg);
    const r = 0.032 - i * 0.004;
    addMesh(seg, new THREE.CylinderGeometry(r, r + 0.006, 0.2, 8), M.coat, 0, -0.1, 0);
    tailSegs.push(seg);
    tailParent = seg;
    tp = new THREE.Vector3(0, -0.2, 0);
  }
  // очёс-подвес на хвосте
  addMesh(tailSegs[4], new THREE.ConeGeometry(0.035, 0.14, 8), M.coatDark, 0, -0.24, 0);

  // ---------- НОГИ: длинные, сухие, с суставами
  function makeLeg(x, z, isFront) {
    const hip = new THREE.Group();
    hip.position.set(x, isFront ? 1.02 : 1.1, z);
    body.add(hip);
    const upperLen = isFront ? 0.42 : 0.48;
    const upper = addMesh(hip, new THREE.CylinderGeometry(0.05, 0.038, upperLen, 10), M.coat, 0, -upperLen / 2, 0);
    if (!isFront) upper.scale.set(1.4, 1, 1.6); // мускулистое бедро
    const knee = new THREE.Group();
    knee.position.set(0, -upperLen, 0);
    hip.add(knee);
    const lowerLen = isFront ? 0.5 : 0.55;
    addMesh(knee, new THREE.CylinderGeometry(0.032, 0.026, lowerLen, 8), M.coat, 0, -lowerLen / 2, 0);
    // лапа
    const paw = addMesh(knee, new THREE.SphereGeometry(0.045, 8, 6), M.coatDark, 0, -lowerLen, -0.02);
    paw.scale.set(1, 0.7, 1.4);
    return { hip, knee };
  }
  const legFL = makeLeg(-0.14, -0.52, true);
  const legFR = makeLeg(0.14, -0.52, true);
  const legRL = makeLeg(-0.15, 0.52, false);
  const legRR = makeLeg(0.15, 0.52, false);

  root.traverse(o => { if (o.isMesh) o.castShadow = true; });

  // ---------- АНИМАЦИЯ ГАЛОПА (двойное подвисание, как у борзых)
  const legs = [
    { l: legFL, ph: 0.0, front: true },
    { l: legFR, ph: 0.12, front: true },
    { l: legRL, ph: 0.5, front: false },
    { l: legRR, ph: 0.62, front: false },
  ];
  function animate(t, speed, state) {
    // мах галопа ≈ 2.6 юнита: частота шага = скорость мира / длину маха,
    // тогда лапы визуально «цепляются» за землю, а не скользят по ней
    const STRIDE = 2.6;
    const T = t * (speed / STRIDE) * Math.PI * 2;
    const speedNorm = Math.min(1, Math.max(0, (speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
    // корпус наклонён вперёд тем сильнее, чем выше скорость
    root.rotation.x = -0.03 - speedNorm * 0.05;
    if (state === 'run') {
      const amp = 0.85;
      for (const { l, ph, front } of legs) {
        const p = T + ph * Math.PI * 2;
        l.hip.rotation.x = Math.sin(p) * amp * (front ? 1 : 0.9);
        // колено складывается при выносе ноги
        const fold = Math.max(0, Math.sin(p + (front ? 1.9 : 1.5)));
        l.knee.rotation.x = front ? fold * 1.15 : -fold * 1.05;
      }
      // корпус: вертикальный ход + продольная качка
      body.position.y = Math.abs(Math.sin(T)) * 0.09 - 0.02;
      body.rotation.x = Math.sin(T) * 0.085;
      // хвост струится (волна медленнее шага, иначе дребезжит)
      for (let i = 0; i < tailSegs.length; i++) {
        tailSegs[i].rotation.x = tailCurve[i] + Math.sin(T * 0.5 - i * 0.7) * 0.1;
        tailSegs[i].rotation.z = Math.sin(T * 0.25 - i * 0.5) * 0.06;
      }
      // уши летят по ветру (отброшены назад)
      for (let i = 0; i < ears.length; i++) {
        ears[i].rotation.x = -0.35 + Math.sin(T * 0.5 + i) * 0.12;
      }
    } else if (state === 'jump') {
      // ноги поджаты в полёте
      for (const { l, front } of legs) {
        l.hip.rotation.x = front ? -0.9 : 0.85;
        l.knee.rotation.x = front ? 1.5 : -1.4;
      }
      body.rotation.x = -0.18;
      for (let i = 0; i < tailSegs.length; i++) tailSegs[i].rotation.x = tailCurve[i] * 0.6;
    } else if (state === 'slide') {
      // стелется по земле
      for (const { l, front } of legs) {
        l.hip.rotation.x = front ? -1.25 : 1.2;
        l.knee.rotation.x = front ? 1.9 : -1.7;
      }
      body.rotation.x = 0.12;
      body.position.y = -0.52;
      neck.rotation.x = -1.15; // шея вытянута вперёд над землёй
    }
    if (state !== 'slide') neck.rotation.x = -0.6 + (state === 'run' ? Math.sin(T) * 0.04 : -0.05);
  }
  return { root, animate };
}

// ============================================================ СТЕПЬ / ОКРУЖЕНИЕ
// Земля: канвас-текстура степи с тропой
function makeSteppeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#b5a15e'; g.fillRect(0, 0, 512, 512);
  // пятна выгоревшей травы
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    g.fillStyle = ['#a8954f', '#c2ad6a', '#9c8c52', '#bfa963'][i % 4];
    g.beginPath(); g.arc(x, y, 1 + Math.random() * 3.5, 0, 7); g.fill();
  }
  // протоптанная тропа по центру
  const grad = g.createLinearGradient(140, 0, 372, 0);
  grad.addColorStop(0, 'rgba(160,138,88,0)');
  grad.addColorStop(0.25, 'rgba(150,126,78,0.55)');
  grad.addColorStop(0.5, 'rgba(158,132,82,0.7)');
  grad.addColorStop(0.75, 'rgba(150,126,78,0.55)');
  grad.addColorStop(1, 'rgba(160,138,88,0)');
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
    if (h > 16) { // снежная шапка
      const snow = new THREE.Mesh(new THREE.ConeGeometry(2.4, h * 0.28, 5), mat(C.mountainSnow, { flatShading: true }));
      snow.position.set(peak.position.x, h - h * 0.14 - 1.5, peak.position.z + 0.1);
      ridge.add(snow);
    }
  }
  scene.add(ridge);
}

// ---- Юрта (декор и препятствие)
function makeYurtOrnamentTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#7a1f1f'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 50, 256, 14);
  g.strokeStyle = '#7a1f1f'; g.lineWidth = 4;
  for (let x = 8; x < 256; x += 32) { // упрощённый қошқар мүйіз
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
  // орнаментный пояс
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(1.52, 1.52, 0.36, 20, 1, true),
    new THREE.MeshStandardMaterial({ map: yurtOrnTex, roughness: 0.9 })
  );
  band.position.y = 0.92; y.add(band);
  // купол
  addMesh(y, new THREE.SphereGeometry(1.52, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), M.felt, 0, 0.62, 0).scale.set(1, 0.95, 1);
  // шаңырақ
  addMesh(y, new THREE.TorusGeometry(0.3, 0.07, 8, 16), M.wood, 0, 1.98, 0).rotation.x = Math.PI / 2;
  // дверь (резная, красная с золотом)
  const door = addMesh(y, new THREE.BoxGeometry(0.62, 0.85, 0.08), M.ornRed, 0, 0.45, 1.53);
  addMesh(door, new THREE.BoxGeometry(0.68, 0.1, 0.1), M.gold, 0, 0.46, 0);
  y.scale.setScalar(scale);
  y.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return y;
}

// ---- Верблюд (стилизованный двугорбый бактриан)
function makeCamel() {
  const c = new THREE.Group();
  const bodyM = addMesh(c, new THREE.SphereGeometry(1, 16, 12), M.camel, 0, 1.35, 0);
  bodyM.scale.set(0.5, 0.55, 1.0);
  for (const hz of [-0.38, 0.34]) {
    const hump = addMesh(c, new THREE.SphereGeometry(0.34, 12, 10), M.camel, 0, 1.95, hz);
    hump.scale.set(0.8, 1, 0.9);
    addMesh(c, new THREE.SphereGeometry(0.15, 8, 6), mat(0x8a6a3a), 0, 2.25, hz);
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
  // ковровая попона с орнаментом
  const rug = addMesh(c, new THREE.BoxGeometry(1.15, 0.5, 0.9), M.ornRed, 0, 1.5, -0.02);
  addMesh(rug, new THREE.BoxGeometry(1.2, 0.12, 0.95), M.gold, 0, -0.15, 0);
  c.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return c;
}

// ---- Деревянная повозка (арба)
function makeCart() {
  const c = new THREE.Group();
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 1.1), M.wood, 0, 1.0, 0);
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 0.12), M.wood, 0, 1.35, -0.55);
  addMesh(c, new THREE.BoxGeometry(1.7, 0.5, 0.12), M.wood, 0, 1.35, 0.55);
  for (const s of [-1, 1]) {
    const wheel = addMesh(c, new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14), M.wood, s * 0.92, 0.55, 0);
    wheel.rotation.z = Math.PI / 2;
  }
  // тюк с золотым шнуром
  const bale = addMesh(c, new THREE.SphereGeometry(0.45, 10, 8), M.felt, 0, 1.55, 0);
  bale.scale.set(1.4, 0.9, 1);
  addMesh(bale, new THREE.TorusGeometry(0.46, 0.03, 6, 16), M.gold, 0, 0, 0).rotation.x = Math.PI / 2;
  c.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return c;
}

// ---- Низкий плетень (прыжок)
function makeFence() {
  const f = new THREE.Group();
  for (const x of [-0.8, 0, 0.8]) addMesh(f, new THREE.CylinderGeometry(0.05, 0.06, 0.85, 8), M.wood, x, 0.42, 0);
  addMesh(f, new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8), M.wood, 0, 0.72, 0).rotation.z = Math.PI / 2;
  addMesh(f, new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8), M.wood, 0, 0.42, 0).rotation.z = Math.PI / 2;
  f.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return f;
}

// ---- Арка с тканью-орнаментом (подкат)
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

// ---- Балбал (каменное изваяние) — декор
function makeBalbal() {
  const b = new THREE.Group();
  addMesh(b, new THREE.CylinderGeometry(0.32, 0.42, 1.7, 8), M.stone, 0, 0.85, 0);
  addMesh(b, new THREE.SphereGeometry(0.3, 10, 8), M.stone, 0, 1.8, 0).scale.set(1, 1.15, 0.9);
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return b;
}

// ---- Саксаул/куст — декор
function makeBush() {
  const b = new THREE.Group();
  addMesh(b, new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6), M.wood, 0, 0.35, 0);
  for (let i = 0; i < 3; i++) {
    addMesh(b, new THREE.SphereGeometry(0.35 + Math.random() * 0.2, 8, 6),
      mat(0x7d7a3e, { flatShading: true }), (Math.random() - 0.5) * 0.5, 0.85 + Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
  }
  b.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return b;
}

// ---- Асык (коллектибл) — золотой альчик
function makeAsyk() {
  const g = new THREE.Group();
  const core = addMesh(g, new THREE.DodecahedronGeometry(0.24, 0), M.gold, 0, 0, 0);
  core.scale.set(0.85, 1.15, 0.7);
  return g;
}

// Беркут в небе (декор)
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

// ---- Пыль из-под лап: даёт ощущение скорости у самой собаки
const dustPool = [];
{
  const dustMat = new THREE.MeshBasicMaterial({ color: 0x9c8a55, transparent: true, opacity: 0.35, depthWrite: false });
  for (let i = 0; i < 24; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), dustMat.clone());
    p.scale.set(1.4, 0.6, 1.4); // приплюснутые клубы
    p.visible = false;
    p.userData.life = 0;
    scene.add(p);
    dustPool.push(p);
  }
}
let dustTimer = 0;
function spawnDust(x, z) {
  const p = dustPool.find(d => !d.visible);
  if (!p) return;
  p.visible = true;
  p.userData.life = 1;
  p.position.set(x + (Math.random() - 0.5) * 0.7, 0.04, z + 0.4 + Math.random() * 0.5);
  const s = 0.35 + Math.random() * 0.45;
  p.scale.set(s * 1.4, s * 0.6, s * 1.4);
}
function updateDust(dt, dz) {
  for (const p of dustPool) {
    if (!p.visible) continue;
    p.userData.life -= dt * 2.8;
    if (p.userData.life <= 0) { p.visible = false; continue; }
    p.position.z += dz;            // пыль уносится назад вместе с миром
    p.position.y += dt * 0.5;
    p.scale.multiplyScalar(1 + dt * 3.2);
    p.material.opacity = 0.35 * p.userData.life * p.userData.life;
  }
}

// ============================================================ ИГРОВОЕ СОСТОЯНИЕ
const tazy = createTazy();
tazy.root.position.set(0, 0, 0);
scene.add(tazy.root);

const game = {
  running: false,
  speed: START_SPEED,
  t: 0,
  lane: 1,
  laneX: 0,
  y: 0, vy: 0,
  state: 'run', // run | jump | slide
  slideTimer: 0,
  score: 0, asyks: 0,
  distSinceObstacle: 0, distSinceDecor: 0, distSinceAsyk: 0,
};

const obstacles = []; // {group, kind, lane}
const decors = [];
const coins = [];

// ---- Скальные стены каньона (Чарын): «коридор» по бокам трассы,
// главный источник ощущения скорости — как стены/поезда в Subway Surfers
const rockMats = [
  mat(0xb5764a, { flatShading: true, roughness: 0.95 }),
  mat(0xa3663f, { flatShading: true, roughness: 0.95 }),
  mat(0xc48857, { flatShading: true, roughness: 0.95 }),
  mat(0x8f5636, { flatShading: true, roughness: 0.95 }),
];
function makeCliff() {
  const g = new THREE.Group();
  const h = 2.2 + Math.random() * 2.8;
  let y = 0;
  // слоистые глыбы друг на друге, каждый слой чуть уже — силуэт каньона
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
// иногда вместо скалы — пирамидальный тополь
function makePoplar() {
  const g = new THREE.Group();
  addMesh(g, new THREE.CylinderGeometry(0.09, 0.13, 1.1, 7), M.wood, 0, 0.55, 0);
  const crown = addMesh(g, new THREE.ConeGeometry(0.75, 3.6, 8), mat(0x5e7a38, { flatShading: true }), 0, 2.6, 0);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function spawnWall(side, z = SPAWN_Z - Math.random() * 4) {
  const obj = Math.random() < 0.82 ? makeCliff() : makePoplar();
  obj.position.set(side * (6.3 + Math.random() * 1.4), 0, z);
  scene.add(obj);
  decors.push(obj);
}

// Мелочь у самой тропы: кочки/камешки для ближнего параллакса
function spawnTrackside() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const small = Math.random() < 0.6;
  const obj = new THREE.Group();
  if (small) {
    const tuft = addMesh(obj, new THREE.SphereGeometry(0.14 + Math.random() * 0.12, 7, 5),
      mat(0x8f8a4e, { flatShading: true }), 0, 0.08, 0);
    tuft.scale.y = 0.6;
  } else {
    addMesh(obj, new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.14, 0), M.stone, 0, 0.1, 0);
  }
  obj.position.set(side * (3.4 + Math.random() * 1.8), 0, SPAWN_Z - Math.random() * 8);
  obj.rotation.y = Math.random() * Math.PI * 2;
  scene.add(obj);
  decors.push(obj);
}

function spawnDecor() {
  const side = Math.random() < 0.5 ? -1 : 1;
  const kind = Math.random();
  let obj, x;
  if (kind < 0.3) { obj = makeYurt(1.6 + Math.random()); x = side * (9 + Math.random() * 12); }
  else if (kind < 0.45) { obj = makeBalbal(); x = side * (6 + Math.random() * 8); }
  else { obj = makeBush(); x = side * (5 + Math.random() * 14); }
  obj.position.set(x, 0, SPAWN_Z - Math.random() * 20);
  obj.rotation.y = Math.random() * Math.PI * 2;
  scene.add(obj);
  decors.push(obj);
}

const OBSTACLE_TYPES = [
  { make: makeFence, kind: 'jump' },   // перепрыгнуть
  { make: makeArch, kind: 'slide' },   // проскользить
  { make: makeCamel, kind: 'block' },  // объехать
  { make: makeCart, kind: 'block' },
  { make: () => makeYurt(0.85), kind: 'block' },
];

function spawnObstaclePattern() {
  const nLanes = Math.random() < 0.45 && game.speed > 17 ? 2 : 1;
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, nLanes);
  const z = SPAWN_Z;
  for (const lane of lanes) {
    const t = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
    const grp = t.make();
    grp.position.set(LANE_X[lane], 0, z);
    scene.add(grp);
    obstacles.push({ group: grp, kind: t.kind, lane });
    // дуга асыков над прыжковым препятствием
    if (t.kind === 'jump' && Math.random() < 0.6) {
      for (let i = -2; i <= 2; i++) {
        const a = makeAsyk();
        a.position.set(LANE_X[lane], 1.1 + Math.cos(i * 0.55) * 1.0, z + i * 1.1);
        scene.add(a); coins.push(a);
      }
    }
  }
}

function spawnAsykLine() {
  const lane = Math.floor(Math.random() * 3);
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const a = makeAsyk();
    a.position.set(LANE_X[lane], 0.85, SPAWN_Z - i * 1.6);
    scene.add(a); coins.push(a);
  }
}

// ============================================================ ЗВУК (WebAudio, домбровые пентатонические плюки)
const audio = { ctx: null, muted: false, nextPluck: 0 };
function ac() {
  if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
  return audio.ctx;
}
function pluck(freq, vol = 0.12, dur = 0.4) {
  if (audio.muted) return;
  const ctx = ac();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + dur);
}
const PENTA = [220, 261.6, 293.7, 349.2, 392]; // пентатоника, близко к казахским кюям
function backgroundPluck(t) {
  if (audio.muted || !audio.ctx) return;
  if (t > audio.nextPluck) {
    pluck(PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.25 ? 2 : 1), 0.045, 0.5);
    audio.nextPluck = t + 0.22 + Math.random() * 0.25;
  }
}
function sfxCoin() { pluck(880, 0.1, 0.15); pluck(1318, 0.08, 0.22); }
function sfxJump() { pluck(330, 0.09, 0.25); }
function sfxHit() {
  if (audio.muted) return;
  const ctx = ac();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(160, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5);
  g.gain.setValueAtTime(0.22, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
  o.connect(g).connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.6);
}
document.getElementById('mute-btn').addEventListener('click', (e) => {
  audio.muted = !audio.muted;
  e.target.textContent = audio.muted ? '🔇' : '🔊';
});

// ============================================================ УПРАВЛЕНИЕ
function moveLane(dir) {
  if (!game.running) return;
  game.lane = Math.max(0, Math.min(2, game.lane + dir));
}
function doJump() {
  if (!game.running || game.state !== 'run') return;
  game.state = 'jump';
  game.vy = JUMP_VY;
  sfxJump();
}
function doSlide() {
  if (!game.running) return;
  if (game.state === 'jump') { game.vy = -20; return; } // быстрое приземление
  game.state = 'slide';
  game.slideTimer = SLIDE_TIME;
}
window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'a') moveLane(-1);
  else if (e.key === 'ArrowRight' || e.key === 'd') moveLane(1);
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') doJump();
  else if (e.key === 'ArrowDown' || e.key === 's') doSlide();
});
// свайпы
let touchStart = null;
window.addEventListener('touchstart', (e) => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) { doJump(); return; }
  if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) doJump(); else doSlide();
}, { passive: true });

// ============================================================ UI
const $ = id => document.getElementById(id);
const scoreEl = $('score'), asykEl = $('asyk-count');
const startOverlay = $('start-overlay'), gameoverOverlay = $('gameover-overlay');

function startGame() {
  for (const o of obstacles) scene.remove(o.group);
  for (const d of decors) scene.remove(d);
  for (const c of coins) scene.remove(c);
  obstacles.length = decors.length = coins.length = 0;
  Object.assign(game, {
    running: true, speed: START_SPEED, t: 0, lane: 1, laneX: 0,
    y: 0, vy: 0, state: 'run', slideTimer: 0, score: 0, asyks: 0,
    distSinceObstacle: -20, distSinceDecor: 0, distSinceAsyk: -10,
  });
  for (let i = 0; i < 10; i++) { spawnDecor(); decors[decors.length - 1].position.z = -10 - i * 10; }
  // коридор из скал уже стоит с первого кадра
  for (let z = -6; z > SPAWN_Z; z -= 4.5) {
    spawnWall(-1, z - Math.random() * 2);
    spawnWall(1, z - Math.random() * 2);
  }
  startOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  ac().resume?.();
  lastTime = performance.now();
}
function gameOver() {
  game.running = false;
  sfxHit();
  const score = Math.floor(game.score);
  const best = Math.max(score, +(localStorage.getItem('tazy-best') || 0));
  localStorage.setItem('tazy-best', best);
  $('final-stats').textContent = `Ұпай: ${score} · Асық: ${game.asyks}`;
  $('best-line').textContent = `Рекорд: ${best}`;
  setTimeout(() => gameoverOverlay.classList.remove('hidden'), 500);
}
$('start-btn').addEventListener('click', startGame);
$('restart-btn').addEventListener('click', startGame);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !game.running) startGame();
});

// ============================================================ ГЛАВНЫЙ ЦИКЛ
let lastTime = performance.now();
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
    game.speed = Math.min(MAX_SPEED, START_SPEED + game.t * 0.28);
    const dz = game.speed * dt;
    game.score += dz * 0.6;

    // --- физика собаки
    game.laneX += (LANE_X[game.lane] - game.laneX) * Math.min(1, dt * 12);
    if (game.state === 'jump') {
      game.vy += GRAVITY * dt;
      game.y += game.vy * dt;
      if (game.y <= 0) { game.y = 0; game.vy = 0; game.state = 'run'; }
    } else if (game.state === 'slide') {
      game.slideTimer -= dt;
      if (game.slideTimer <= 0) game.state = 'run';
    }
    tazy.root.position.set(game.laneX, game.y, 0);
    tazy.root.rotation.z = (LANE_X[game.lane] - game.laneX) * -0.12;
    tazy.animate(game.t, game.speed, game.state);

    // --- пыль из-под лап
    if (game.state !== 'jump') {
      dustTimer -= dt;
      if (dustTimer <= 0) { dustTimer = 0.9 / game.speed; spawnDust(game.laneX, 0); }
    }
    updateDust(dt, game.speed * dt);

    // --- прокрутка мира
    // тайл текстуры = 260/24 ≈ 10.83 юнита → сдвиг offset на юнит = 24/260
    groundTex.offset.y -= dz * (24 / 260);
    for (const o of obstacles) o.group.position.z += dz;
    for (const d of decors) d.position.z += dz;
    for (const c of coins) { c.position.z += dz; c.rotation.y += dt * 5; }

    // --- спавн
    game.distSinceObstacle += dz;
    game.distSinceDecor += dz;
    game.distSinceAsyk += dz;
    const gap = Math.max(15, 30 - game.speed * 0.45);
    if (game.distSinceObstacle > gap) { game.distSinceObstacle = 0; spawnObstaclePattern(); }
    if (game.distSinceDecor > 9) { game.distSinceDecor = 0; spawnDecor(); }
    game.distSinceTrackside = (game.distSinceTrackside || 0) + dz;
    if (game.distSinceTrackside > 3.5) { game.distSinceTrackside = 0; spawnTrackside(); }
    // стены коридора — каждая сторона своим шагом
    game.distSinceWallL = (game.distSinceWallL || 0) + dz;
    game.distSinceWallR = (game.distSinceWallR || 0) + dz;
    if (game.distSinceWallL > 4.5) { game.distSinceWallL = Math.random() * 1.5; spawnWall(-1); }
    if (game.distSinceWallR > 4.5) { game.distSinceWallR = Math.random() * 1.5; spawnWall(1); }
    if (game.distSinceAsyk > 26) { game.distSinceAsyk = 0; spawnAsykLine(); }

    // --- коллизии
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (o.group.position.z > KILL_Z) { scene.remove(o.group); obstacles.splice(i, 1); continue; }
      if (Math.abs(o.group.position.z) < 0.9 && o.lane === game.lane) {
        const clear =
          (o.kind === 'jump' && game.y > 0.75) ||
          (o.kind === 'slide' && game.state === 'slide');
        if (!clear) { gameOver(); break; }
      }
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      if (c.position.z > KILL_Z) { scene.remove(c); coins.splice(i, 1); continue; }
      const dy = c.position.y - (0.85 + game.y);
      if (Math.abs(c.position.z) < 0.8 && Math.abs(c.position.x - game.laneX) < 1.0 && Math.abs(dy) < 1.0) {
        scene.remove(c); coins.splice(i, 1);
        game.asyks++; game.score += 15;
        sfxCoin();
      }
    }
    for (let i = decors.length - 1; i >= 0; i--) {
      if (decors[i].position.z > KILL_Z + 10) { scene.remove(decors[i]); decors.splice(i, 1); }
    }

    // --- камера дышит и следует за полосой
    camera.position.x += (game.laneX * 0.45 - camera.position.x) * dt * 4;
    camera.position.y = 3.4 + Math.sin(game.t * 2.2) * 0.03;
    camera.position.z = 7.2;
    // FOV раскрывается со скоростью — усиливает ощущение разгона
    const targetFov = 58 + ((game.speed - START_SPEED) / (MAX_SPEED - START_SPEED)) * 10;
    camera.fov += (targetFov - camera.fov) * dt * 2;
    camera.updateProjectionMatrix();
    camera.lookAt(game.laneX * 0.6, 1.1, -6);

    backgroundPluck(t);

    scoreEl.textContent = Math.floor(game.score);
    asykEl.textContent = game.asyks;
  } else {
    // на заставке собака трусит на месте
    tazy.animate(t, 7, 'run');
    if (DEBUG_DOG) {
      // ?debug=dog — осмотр модели по кругу
      camera.position.set(3.4, 1.15, -0.1); // строго сбоку
      camera.lookAt(0, 0.9, 0);
    } else {
      camera.position.x = Math.sin(t * 0.25) * 1.2;
      camera.lookAt(0, 1.0, -3);
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
if (DEBUG_DOG) window.__dbg = { scene, game, tazy, camera };

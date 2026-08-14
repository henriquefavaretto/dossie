// Campo de partículas do fundo.
//
// Traços curtos espalhados, quase invisíveis em repouso. O ponteiro age como uma
// lanterna: dentro de um raio, os traços acendem, crescem, se afastam um pouco e
// se alinham à direção do movimento. Fora dele, voltam a sumir.

const canvas = document.getElementById('field');
const ctx = canvas?.getContext('2d', { alpha: true });

const REVEAL_RADIUS = 210; // alcance da "lanterna", em px
const BASE_ALPHA = 0.1; // visibilidade em repouso
const REVEAL_ALPHA = 0.92; // visibilidade no centro do ponteiro
const DENSITY = 2900; // um traço a cada N px² de tela

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let width = 0;
let height = 0;
let particles = [];
let colors = [];
let frame = 0;

// posição real do ponteiro e a versão suavizada que a animação persegue
const pointer = { x: -9999, y: -9999, sx: -9999, sy: -9999, vx: 0, vy: 0, strength: 0, target: 0 };

/**
 * Curva de revelação: quanto um traço acende a `dist` px do ponteiro.
 * Pura de propósito — é o coração do efeito e dá para testar sem navegador.
 * @returns {{alpha:number, boost:number}} boost 0 = repouso, 1 = centro
 */
export function revealAt(dist, strength = 1, radius = REVEAL_RADIUS) {
  if (dist >= radius || strength <= 0) return { alpha: BASE_ALPHA, boost: 0 };
  const t = 1 - dist / radius;
  const falloff = t * t * (3 - 2 * t); // smoothstep: sem quina na borda
  const boost = falloff * strength;
  return { alpha: BASE_ALPHA + boost * (REVEAL_ALPHA - BASE_ALPHA), boost };
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent').trim() || '#2b5cff';
  const faint = style.getPropertyValue('--ink-3').trim() || '#6b6e76';
  // proporção observada na referência: azul domina, cinza pontua, quente é raro
  return [accent, accent, accent, accent, accent, accent, faint, faint, '#d0503c'];
}

function build() {
  const count = Math.min(Math.round((width * height) / DENSITY), 520);
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    angle: Math.random() * Math.PI,
    length: 4 + Math.random() * 7,
    weight: 1.4 + Math.random() * 1.1,
    color: colors[(Math.random() * colors.length) | 0],
    // cada traço oscila no seu próprio ritmo, senão o campo pulsa junto
    phase: Math.random() * Math.PI * 2,
    speed: 0.15 + Math.random() * 0.35,
  }));
}

function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Sem layout ainda (folha de estilo pendente) não há o que dimensionar; o
  // ResizeObserver chama de novo assim que o elemento ganhar tamanho.
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = rect.width;
  height = rect.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  colors = readColors();
  build();
  draw();
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';

  const revealing = pointer.strength > 0.01;

  for (const p of particles) {
    let alpha = BASE_ALPHA;
    let x = p.x;
    let y = p.y;
    let angle = p.angle;
    let length = p.length;

    if (revealing) {
      const dx = p.x - pointer.sx;
      const dy = p.y - pointer.sy;
      const dist = Math.hypot(dx, dy);

      if (dist < REVEAL_RADIUS) {
        const reveal = revealAt(dist, pointer.strength);
        const { boost } = reveal;
        alpha = reveal.alpha;
        length = p.length * (1 + boost * 0.7);

        // empurra levemente para fora, como se o ponteiro deslocasse o campo
        const push = boost * 10;
        const inv = dist || 1;
        x += (dx / inv) * push;
        y += (dy / inv) * push;

        // e alinha o traço à direção do movimento do ponteiro
        const motion = Math.hypot(pointer.vx, pointer.vy);
        if (motion > 0.4) {
          const target = Math.atan2(pointer.vy, pointer.vx);
          angle = p.angle + (target - p.angle) * boost * 0.55;
        }
      }
    }

    if (!reduceMotion) {
      // respiro lento para o campo não parecer congelado
      angle += Math.sin(frame * 0.008 * p.speed + p.phase) * 0.16;
    }

    const half = length / 2;
    const cos = Math.cos(angle) * half;
    const sin = Math.sin(angle) * half;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.weight;
    ctx.beginPath();
    ctx.moveTo(x - cos, y - sin);
    ctx.lineTo(x + cos, y + sin);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function tick() {
  frame += 1;

  // perseguição suave: o brilho acompanha o ponteiro com um leve atraso
  const prevX = pointer.sx;
  const prevY = pointer.sy;
  pointer.sx += (pointer.x - pointer.sx) * 0.16;
  pointer.sy += (pointer.y - pointer.sy) * 0.16;
  pointer.vx = pointer.sx - prevX;
  pointer.vy = pointer.sy - prevY;
  pointer.strength += (pointer.target - pointer.strength) * 0.09;

  draw();
  requestAnimationFrame(tick);
}

function onPointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  // primeiro contato entra sem varrer a tela toda
  if (pointer.target === 0) {
    pointer.sx = x;
    pointer.sy = y;
  }
  pointer.x = x;
  pointer.y = y;
  pointer.target = y >= -80 && y <= rect.height + 80 ? 1 : 0;
}

function init() {
  if (!canvas || !ctx) return;

  // Módulo executa antes da folha de estilo aplicar: nesse instante o canvas
  // ainda mede 0x0. O ResizeObserver dispara na primeira observação e a cada
  // mudança de tamanho, então cobre esse caso e o redimensionar da janela.
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => resize()).observe(canvas);
  } else {
    window.addEventListener('resize', debounce(resize, 150));
  }
  resize();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    colors = readColors();
    build();
    draw();
  });

  if (reduceMotion) return; // campo estático, sem interação

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', () => {
    pointer.target = 0;
  });
  requestAnimationFrame(tick);
}

function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

init();

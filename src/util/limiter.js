// Controle de vazao por buscador + disjuntor.
//
// Aprendido na marra: o DuckDuckGo bloqueia depois de ~12 requisicoes em rajada
// e passa a devolver pagina vazia (HTTP 200, zero resultado) por varios minutos.
// Disparar 25 dorks em paralelo contra ele nao traz 250 resultados: traz zero.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Limiter {
  /**
   * @param {{minInterval?:number, concurrency?:number, breakerThreshold?:number}} opts
   * minInterval - espera minima entre duas chamadas ao mesmo buscador
   * breakerThreshold - respostas vazias/erro seguidas antes de desistir dele
   */
  constructor({ minInterval = 0, concurrency = 4, breakerThreshold = 3 } = {}) {
    this.minInterval = minInterval;
    this.concurrency = concurrency;
    this.breakerThreshold = breakerThreshold;
    this.lastCall = 0;
    this.active = 0;
    this.queue = [];
    this.consecutiveFailures = 0;
    this.tripped = false;
  }

  get isOpen() {
    return !this.tripped;
  }

  /** Sinaliza resultado; N falhas seguidas abrem o disjuntor. */
  report(ok) {
    if (ok) {
      this.consecutiveFailures = 0;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.breakerThreshold) this.tripped = true;
  }

  async run(task) {
    if (this.tripped) throw new Error('circuito aberto: buscador bloqueando');

    while (this.active >= this.concurrency) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active += 1;

    try {
      const wait = this.lastCall + this.minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/** Um limitador por buscador, recriado a cada busca (disjuntor nao vaza). */
export function createLimiters() {
  return {
    // Scrapers gratuitos: devagar e com disjuntor curto.
    duckduckgo: new Limiter({ minInterval: 1100, concurrency: 1, breakerThreshold: 3 }),
    bravehtml: new Limiter({ minInterval: 1400, concurrency: 1, breakerThreshold: 3 }),
    bing: new Limiter({ minInterval: 800, concurrency: 2, breakerThreshold: 3 }),
    youtube: new Limiter({ minInterval: 500, concurrency: 1, breakerThreshold: 2 }),
    // APIs com chave ou generosas: podem ir a fundo.
    brave: new Limiter({ minInterval: 1100, concurrency: 1, breakerThreshold: 4 }),
    google: new Limiter({ minInterval: 120, concurrency: 4, breakerThreshold: 4 }),
    searxng: new Limiter({ minInterval: 200, concurrency: 3, breakerThreshold: 4 }),
    default: new Limiter({ minInterval: 150, concurrency: 4, breakerThreshold: 3 }),
  };
}

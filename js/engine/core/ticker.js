// ticker.js — фіксований такт симуляції: накопичувач часу кадру, кроки по dt; понад maxSteps за кадр — зайвий час
// відкидаємо (після паузи чи зависання світ не «доганяє» ривком). alpha — частка до наступного кроку (інтерполяція кадру)
export function createTicker(dt, maxSteps = 8) {
  let acc = 0;
  return {
    dt,
    // Скільки кроків зробити за кадр тривалістю frameDt (с)
    advance(frameDt) {
      acc += frameDt;
      let n = Math.floor(acc / dt + 1e-9);
      if (n > maxSteps) { n = maxSteps; acc = 0; } else acc -= n * dt;
      if (acc < 0) acc = 0;
      return n;
    },
    get alpha() { return Math.min(0.999999, acc / dt); },
    reset() { acc = 0; },
  };
}

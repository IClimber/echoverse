// golden.js — еталонні відбитки чанків (генератор v12): той самий набір перевіряють тести (Node, V8)
// і стенд ?strip у браузері (Firefox — SpiderMonkey, Safari — JavaScriptCore). Розбіжність = рушій рахує інакше
// або змінився генератор (тоді — підняти GEN і оновити еталони свідомо).
export const SPOTS = [[0, 0, 0, 0], [0, 1, -1, 2], [1, -5, 3, -4], [0, 1000, 100, -100]];   // [d, n, cx, cy]
export const GOLD = {
  test: ['6b51cf3f', 'e1d14c3a', '4d22fcec', '4380b4fb'],
  abc: ['13b3b1eb', 'f6a8cf3f', '31ae0a9a', '819d4275'],
  42: ['f493b190', '174dfeea', '51da3a6a', '7c6bece3'],
};

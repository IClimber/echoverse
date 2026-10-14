// gen/materials.js — матеріали граней: номер шару процедурної текстури (textures.js) у кожній вершині меша.
export const M_FLAT = 0, M_WATER = 1, M_ICE = 2, M_SAND = 3, M_LUSH = 4, M_DRY = 5, M_DESERT = 6, M_SNOW = 7, M_ROCK = 8,
  M_SOIL = 9, M_CLIFF = 10, M_SANDSIDE = 11, M_LEAF = 12, M_BARK = 13, M_CRYSTAL = 14, M_CAP = 15, M_LIP = 16,
  M_BED = 17, M_MUD = 18, M_LAVA = 19, M_PETAL = 20, M_BLADE = 21, M_CACTUS = 22, M_CORAL = 23, M_STEM = 24;
export const LAYERS = 25;
// Номер матеріалу у вершині — u16 (pos.w щільної вершини): молодші 5 біт — матеріал (< 32, eco_mat), старші 11 — мітка
// проріджування малих рослин 1…THIN_N (0 — не проріджувати): рушій не малює вершину далі від цілі камери, ніж
// межа між eco_thin.x (мітка 0) і eco_thin.y (мітка THIN_N) — трава й квіти до краю кола зблизька рідшають поштучно
export const MAT_BITS = 5, THIN_N = 2047;
// За типом поверхні (T_WATER … T_BED): верх (у водоймі — дно), бічна грань
export const TOP_MAT = [M_BED, M_ICE, M_SAND, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_ROCK, M_MUD];
export const SIDE_MAT = [M_SOIL, M_SOIL, M_SANDSIDE, M_SOIL, M_SOIL, M_SANDSIDE, M_CLIFF, M_CLIFF, M_SOIL];
// Таблиця матеріалів для рушія (engine/graphics/chunks.js, eco_mat): [номер, емісія 0…1, гойдання вітром, поворот клітинок
// текстури (0 — будь-який, 1 — лише 180°, 2 — без повороту), плин текстури (× (0,05; 0,03) за секунду)]. Решта — нулі.
// Вода й лава пливуть (лава — повільно й світиться сама), край дерну — без повороту; брижі, пласти й кора — лише на 180°;
// листя, пелюстки й трава гойдаються. Що ще світиться — п. 5 roadmap (матеріали)
export const MAT_TABLE = [
  [M_WATER, 0, 0, 2, 1], [M_LAVA, 1, 0, 2, 0.16], [M_LIP, 0, 0, 2, 0],
  [M_SAND, 0, 0, 1, 0], [M_DESERT, 0, 0, 1, 0], [M_CLIFF, 0, 0, 1, 0], [M_SANDSIDE, 0, 0, 1, 0], [M_BARK, 0, 0, 1, 0],
  [M_LEAF, 0, 1, 0, 0], [M_PETAL, 0, 1, 0, 0], [M_BLADE, 0, 1, 0, 0],
];

// gen/materials.js — матеріали граней: номер шару процедурної текстури (textures.js) у кожній вершині меша.
export const M_FLAT = 0, M_WATER = 1, M_ICE = 2, M_SAND = 3, M_LUSH = 4, M_DRY = 5, M_DESERT = 6, M_SNOW = 7, M_ROCK = 8,
  M_SOIL = 9, M_CLIFF = 10, M_SANDSIDE = 11, M_LEAF = 12, M_BARK = 13, M_CRYSTAL = 14, M_CAP = 15, M_LIP = 16,
  M_BED = 17, M_MUD = 18, M_LAVA = 19, M_PETAL = 20, M_BLADE = 21, M_CACTUS = 22, M_CORAL = 23, M_STEM = 24;
export const LAYERS = 25;
// За типом поверхні (T_WATER … T_BED): верх (у водоймі — дно), бічна грань, верхня смуга бічної грані (край дерну)
export const TOP_MAT = [M_BED, M_ICE, M_SAND, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_ROCK, M_MUD];
export const SIDE_MAT = [M_SOIL, M_SOIL, M_SANDSIDE, M_SOIL, M_SOIL, M_SANDSIDE, M_CLIFF, M_CLIFF, M_SOIL];
export const LIP_MAT = [M_SOIL, M_ICE, M_SAND, M_LIP, M_LIP, M_DESERT, M_SNOW, M_CLIFF, M_SOIL];

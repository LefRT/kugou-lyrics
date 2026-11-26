const flowerProfiles = {
  cream: { petals: 9, width: 0.21, disk: 0.23, light: "#fbf2d8", shade: "#b8a5a1", center: "#c59a51", seed: "#f4ce79" },
  violet: { petals: 5, width: 0.39, disk: 0.15, light: "#bfb3ef", shade: "#665780", center: "#dec881", seed: "#f8e6b3" },
  rose: { petals: 7, width: 0.35, disk: 0.18, light: "#edb2bf", shade: "#9c597d", center: "#a45c64", seed: "#f1c191" },
  poppy: { petals: 5, width: 0.49, disk: 0.22, light: "#ed8876", shade: "#984954", center: "#4d3b49", seed: "#d7a779" },
  gold: { petals: 5, width: 0.42, disk: 0.2, light: "#f7d987", shade: "#ba884c", center: "#c28d47", seed: "#ffe5a9" },
};

// Each entry sets a stem's direction, length and bloom radius along the bank.
const pondBeds = [
  { root: [91, 128], flowers: [["cream", -44, 51, 6], ["violet", -16, 68, 7], ["cream", 15, 40, 7]] },
  { root: [347, 113], flowers: [["violet", 23, 50, 6.5], ["cream", -13, 38, 6], ["violet", 52, 55, 5]] },
  { root: [779, 129], flowers: [["violet", -43, 50, 7], ["violet", 1, 56, 5], ["cream", 28, 34, 6], ["cream", -11, 32, 5]] },
  { root: [121, 251], flowers: [["violet", -29, 63, 8], ["cream", 4, 43, 7], ["violet", -51, 44, 6]] },
  { root: [247, 326], flowers: [["cream", -26, 59, 9], ["violet", 23, 73, 8], ["cream", 39, 50, 6], ["cream", -50, 38, 6]] },
  { root: [954, 351], flowers: [["gold", -8, 56, 7], ["cream", 18, 61, 6], ["violet", 24, 35, 7]] },
  { root: [176, 468], flowers: [["cream", -25, 64, 9], ["cream", 6, 76, 7], ["violet", 38, 49, 8], ["cream", 58, 62, 6]] },
  { root: [882, 480], flowers: [["gold", -29, 73, 9], ["gold", -52, 53, 7], ["violet", 29, 60, 8], ["cream", 56, 42, 6]] },
  { root: [400, 552], flowers: [["poppy", -35, 110, 9], ["poppy", -5, 105, 10], ["poppy", 41, 91, 9], ["poppy", 73, 75, 8], ["poppy", 105, 64, 7]] },
  { root: [316, 476], flowers: [["gold", 46, 85, 9], ["gold", 58, 53, 7], ["poppy", 67, 92, 7]] },
  { root: [151, 623], flowers: [["poppy", -42, 63, 10], ["cream", -12, 46, 8], ["poppy", 23, 85, 11], ["rose", 51, 67, 10]] },
  { root: [824, 621], flowers: [["rose", -36, 65, 11], ["violet", -2, 81, 10], ["rose", 26, 58, 9], ["violet", 73, 70, 8], ["cream", 92, 48, 7]] },
  { root: [527, 649], flowers: [["rose", -47, 59, 11], ["rose", -12, 43, 8], ["cream", 31, 52, 8], ["rose", 72, 37, 10]] },
];

// The low flower beds trace the larger patches of color in the reference.
// Each row gives a species, center, spread, count, and typical bloom radius.
const flowerDrifts = [
  ["cream", 109, 43, 82, 30, 14, 7],
  ["cream", 147, 118, 80, 33, 12, 6],
  ["cream", 239, 23, 47, 20, 6, 6],
  ["violet", 31, 121, 30, 33, 6, 6],
  ["violet", 216, 76, 43, 30, 7, 7],
  ["violet", 312, 121, 31, 30, 6, 6],
  ["violet", 470, 24, 71, 23, 12, 7],
  ["violet", 724, 67, 48, 31, 9, 7],
  ["violet", 39, 244, 36, 25, 9, 7],
  ["cream", 204, 188, 65, 31, 11, 6],
  ["cream", 80, 283, 58, 27, 10, 7],
  ["cream", 204, 310, 69, 33, 12, 7],
  ["cream", 50, 473, 43, 35, 10, 8],
  ["cream", 137, 447, 64, 32, 13, 8],
  ["cream", 221, 476, 76, 39, 14, 8],
  ["violet", 298, 514, 33, 44, 8, 7],
  ["poppy", 112, 578, 58, 37, 11, 8],
  ["poppy", 207, 611, 58, 30, 9, 8],
  ["rose", 242, 566, 43, 30, 7, 8],
  ["violet", 320, 605, 55, 39, 7, 7],
  ["rose", 415, 584, 52, 35, 10, 9],
  ["rose", 491, 609, 68, 34, 11, 9],
  ["cream", 565, 568, 56, 30, 10, 7],
  ["rose", 661, 588, 73, 32, 12, 9],
  ["rose", 747, 567, 57, 39, 10, 8],
  ["violet", 826, 547, 38, 32, 6, 8],
  ["violet", 883, 615, 72, 35, 12, 9],
  ["rose", 926, 559, 72, 40, 12, 8],
  ["rose", 956, 404, 24, 57, 4, 7],
  ["gold", 872, 368, 26, 24, 4, 7],
];

const pondGarden = { profiles: flowerProfiles, beds: pondBeds, drifts: flowerDrifts };

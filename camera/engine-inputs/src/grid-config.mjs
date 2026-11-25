// Shared local-preview limits and approved arrangements. No image data.
export const MAX_REGIONS = 20;
const layouts = {
  1: [[1,1]],
  2: [[2,1],[1,2]],
  3: [[3,1],[1,3],[2,2]],
  4: [[2,2],[4,1],[1,4]],
  5: [[3,2],[2,3],[5,1],[1,5]],
  6: [[3,2],[2,3]],
  7: [[4,2],[2,4]],
  8: [[4,2],[2,4]],
  9: [[3,3]],
  10: [[5,2],[2,5]],
  11: [[4,3],[3,4]],
  12: [[4,3],[3,4],[6,2],[2,6]],
  13: [[5,3],[3,5],[7,2],[2,7]],
  14: [[7,2],[2,7]],
  15: [[5,3],[3,5]],
  16: [[4,4],[8,2],[2,8]],
  17: [[6,3],[3,6],[5,4],[4,5]],
  18: [[6,3],[3,6],[9,2],[2,9]],
  19: [[5,4],[4,5]],
  20: [[5,4],[4,5],[10,2],[2,10]],
};
// In partial layouts fill left to right, then top to bottom. Unused trailing
// cells remain empty and are never submitted for recognition.
export const GRID_LAYOUTS = Object.freeze(Object.fromEntries(Object.entries(layouts)
  .map(([count,choices])=>[count,Object.freeze(choices.map(choice=>Object.freeze(choice)))])));

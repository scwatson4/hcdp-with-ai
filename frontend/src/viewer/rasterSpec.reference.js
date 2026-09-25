/**
 * Pure helpers for the spec-based raster display path.
 *
 * A `raster_spec` (built by the MCP tool, validated server-side in
 * chatbot/raster_spec.py) describes WHAT to show; these helpers turn it
 * into fetch URLs, color functions, and Leaflet bounds. All pure — the
 * heavy lifting (parseGeoraster, GeoRasterLayer) stays in RasterSpecMap.
 */

import { CLIMATE_COLOR_RAMPS, ISLAND_BOUNDS, EXTENT_TO_ISLAND } from '../data/hawaiiIslands'
import { interpolateColorRamp } from '../components/HawaiiMap'
import { portalDataset } from './portalDatasets'

// Ramps the spec's `colormap` field can name. rainfall/temperature reuse
// the app-wide CLIMATE_COLOR_RAMPS so inline maps match the main map.
// Cross-system reference: shared/style_presets.json mirrors these stops for
// the QGIS side (apply_style_preset) — keep the two in sync when editing.
export const NAMED_RAMPS = {
  rainfall: CLIMATE_COLOR_RAMPS.rainfall,
  temperature: CLIMATE_COLOR_RAMPS.temperature,
  // The same table reversed (purple = low → yellow = high): temperature, ignition probability.
  viridis: [
    [0.0, '#440154'],
    [0.0312, '#450d5f'],
    [0.0625, '#461668'],
    [0.0938, '#472070'],
    [0.125, '#482878'],
    [0.1562, '#45327d'],
    [0.1875, '#423b82'],
    [0.2188, '#404386'],
    [0.25, '#3d4c89'],
    [0.2812, '#3a548b'],
    [0.3125, '#365d8c'],
    [0.3438, '#32658d'],
    [0.375, '#2f6d8e'],
    [0.4062, '#2c758e'],
    [0.4375, '#287c8e'],
    [0.4688, '#25848e'],
    [0.5, '#248c8c'],
    [0.5312, '#22938b'],
    [0.5625, '#209b8a'],
    [0.5938, '#23a286'],
    [0.625, '#2aaa81'],
    [0.6562, '#30b17d'],
    [0.6875, '#39b977'],
    [0.7188, '#4bc06c'],
    [0.75, '#5bc663'],
    [0.7812, '#6bcc5a'],
    [0.8125, '#7fd14e'],
    [0.8438, '#94d640'],
    [0.875, '#a8db34'],
    [0.9062, '#bbdf2b'],
    [0.9375, '#d3e229'],
    [0.9688, '#e8e427'],
    [1.0, '#fde725'],
  ],
  // HCDP portal Viridis in its stored orientation (yellow = low → purple = high): the portal's 10 stops with chroma-js correctLightness applied, sampled at 33 points. Rainfall, humidity, NDVI, SPI.
  viridis_r: [
    [0.0, '#fde725'],
    [0.0312, '#e8e427'],
    [0.0625, '#d3e229'],
    [0.0938, '#bbdf2b'],
    [0.125, '#a8db34'],
    [0.1562, '#94d640'],
    [0.1875, '#7fd14e'],
    [0.2188, '#6bcc5a'],
    [0.25, '#5bc663'],
    [0.2812, '#4bc06c'],
    [0.3125, '#39b977'],
    [0.3438, '#30b17d'],
    [0.375, '#2aaa81'],
    [0.4062, '#23a286'],
    [0.4375, '#209b8a'],
    [0.4688, '#22938b'],
    [0.5, '#248b8c'],
    [0.5312, '#25848e'],
    [0.5625, '#287c8e'],
    [0.5938, '#2c758e'],
    [0.625, '#2f6d8e'],
    [0.6562, '#32658d'],
    [0.6875, '#365d8c'],
    [0.7188, '#3a548b'],
    [0.75, '#3d4c89'],
    [0.7812, '#404386'],
    [0.8125, '#423b82'],
    [0.8438, '#45327d'],
    [0.875, '#482878'],
    [0.9062, '#472070'],
    [0.9375, '#461668'],
    [0.9688, '#450d5f'],
    [1.0, '#440154'],
  ],
  ylgnbu: [
    [0, '#ffffd9'], [0.25, '#c7e9b4'], [0.5, '#41b6c4'],
    [0.75, '#225ea8'], [1.0, '#081d58'],
  ],
  // Diverging — midpoint is white; used for difference maps.
  rdbu: [
    [0, '#b2182b'], [0.25, '#ef8a62'], [0.5, '#f7f7f7'],
    [0.75, '#67a9cf'], [1.0, '#2166ac'],
  ],
  magma: [
    [0, '#000004'], [0.25, '#51127c'], [0.5, '#b73779'],
    [0.75, '#fc8961'], [1.0, '#fcfdbf'],
  ],
  // Sequential blues — relative humidity.
  blues: [
    [0, '#f7fbff'], [0.25, '#c6dbef'], [0.5, '#6baed6'],
    [0.75, '#2171b5'], [1.0, '#08306b'],
  ],
  // Diverging red→yellow→green — NDVI (bare/water low, vegetation high).
  rdylgn: [
    [0, '#a50026'], [0.25, '#f46d43'], [0.5, '#ffffbf'],
    [0.75, '#a6d96a'], [1.0, '#1a9850'],
  ],
  // Sequential yellow→red — fire/ignition probability.
  ylorrd: [
    [0, '#ffffb2'], [0.25, '#fecc5c'], [0.5, '#fd8d3c'],
    [0.75, '#f03b20'], [1.0, '#bd0026'],
  ],
  // HCDP 'Monochromatic' (lightness-corrected blues).
  monochromatic: [
    [0.0, '#f7fbff'],
    [0.0312, '#ecf5fc'],
    [0.0625, '#e1eff8'],
    [0.0938, '#d5e8f5'],
    [0.125, '#cbe3f2'],
    [0.1562, '#bfdcef'],
    [0.1875, '#b4d6eb'],
    [0.2188, '#a9d0e8'],
    [0.25, '#9dcae5'],
    [0.2812, '#93c4e2'],
    [0.3125, '#87bdde'],
    [0.3438, '#7bb7db'],
    [0.375, '#71b1d8'],
    [0.4062, '#67aad4'],
    [0.4375, '#60a4d0'],
    [0.4688, '#599dcb'],
    [0.5, '#5196c7'],
    [0.5312, '#4b90c3'],
    [0.5625, '#4389bf'],
    [0.5938, '#3c82bb'],
    [0.625, '#357bb6'],
    [0.6562, '#2e75b2'],
    [0.6875, '#276eae'],
    [0.7188, '#2067aa'],
    [0.75, '#1961a6'],
    [0.7812, '#115aa2'],
    [0.8125, '#0b539d'],
    [0.8438, '#084d96'],
    [0.875, '#08478d'],
    [0.9062, '#084185'],
    [0.9375, '#083b7c'],
    [0.9688, '#083674'],
    [1.0, '#08306b'],
  ],
  // HCDP 'NWS Radar' 11-colour spectrum.
  nwsradar: [
    [0.0, '#25a1dd'],
    [0.05, '#1267e9'],
    [0.1, '#002ef4'],
    [0.15, '#019579'],
    [0.2, '#02fa00'],
    [0.25, '#19cb00'],
    [0.3, '#319e00'],
    [0.35, '#98cd00'],
    [0.4, '#fdfa00'],
    [0.45, '#e2ca16'],
    [0.5, '#c99b2c'],
    [0.55, '#e39b16'],
    [0.6, '#ff9a00'],
    [0.65, '#ff6700'],
    [0.7, '#fe3300'],
    [0.75, '#e63200'],
    [0.8, '#ce3101'],
    [0.85, '#b43201'],
    [0.9, '#9a3300'],
    [0.95, '#cc367f'],
    [1.0, '#ff3aff'],
  ],
  // Google Turbo in HCDP's orientation (red = low → dark purple = high), sampled from the portal's 256-entry table.
  turbo: [
    [0.0, '#7a0403'],
    [0.0156, '#880802'],
    [0.0312, '#950d01'],
    [0.0469, '#a01101'],
    [0.0625, '#ac1701'],
    [0.0781, '#b71d02'],
    [0.0938, '#c12302'],
    [0.1094, '#ca2a04'],
    [0.125, '#d13005'],
    [0.1406, '#d93807'],
    [0.1562, '#e04009'],
    [0.1719, '#e7490b'],
    [0.1875, '#ec530f'],
    [0.2031, '#f15c13'],
    [0.2188, '#f56817'],
    [0.2344, '#f9741d'],
    [0.25, '#fb8022'],
    [0.2656, '#fd8d27'],
    [0.2812, '#fe972c'],
    [0.2969, '#fea330'],
    [0.3125, '#fdae35'],
    [0.3281, '#fbb838'],
    [0.3438, '#f7c03a'],
    [0.3594, '#f3c83a'],
    [0.375, '#edd03a'],
    [0.3906, '#e6d838'],
    [0.4062, '#dee037'],
    [0.4219, '#d5e735'],
    [0.4375, '#ccec34'],
    [0.4531, '#c2f234'],
    [0.4688, '#b8f735'],
    [0.4844, '#adfa38'],
    [0.5, '#a2fd3d'],
    [0.5156, '#98fe43'],
    [0.5312, '#8aff4d'],
    [0.5469, '#7bfe58'],
    [0.5625, '#6bfd64'],
    [0.5781, '#5dfc70'],
    [0.5938, '#4df97e'],
    [0.6094, '#3ef68c'],
    [0.625, '#31f299'],
    [0.6406, '#26eda6'],
    [0.6562, '#1ee8af'],
    [0.6719, '#19e3b9'],
    [0.6875, '#18dcc3'],
    [0.7031, '#19d5ce'],
    [0.7188, '#1dccd9'],
    [0.7344, '#22c5e2'],
    [0.75, '#29bbec'],
    [0.7656, '#30b1f4'],
    [0.7812, '#37a7fa'],
    [0.7969, '#3d9dfe'],
    [0.8125, '#4294ff'],
    [0.8281, '#458afc'],
    [0.8438, '#467ff6'],
    [0.8594, '#4775ed'],
    [0.875, '#466be2'],
    [0.8906, '#4661d7'],
    [0.9062, '#4456c7'],
    [0.9219, '#424bb5'],
    [0.9375, '#4040a1'],
    [0.9531, '#3d348a'],
    [0.9688, '#3a2a74'],
    [0.9844, '#351e59'],
    [1.0, '#30123b'],
  ],
  // HCDP 'Diverging' red → white → blue.
  diverging: [
    [0.0, '#67001f'],
    [0.0417, '#7a0622'],
    [0.0833, '#8d0c25'],
    [0.125, '#9f1228'],
    [0.1667, '#b2182b'],
    [0.2083, '#bb2a34'],
    [0.25, '#c43c3c'],
    [0.2917, '#cd4e45'],
    [0.3333, '#d6604d'],
    [0.375, '#e08879'],
    [0.4167, '#ebb0a6'],
    [0.4583, '#f5d8d3'],
    [0.5, '#fefeff'],
    [0.5417, '#d1e4f0'],
    [0.5833, '#a1c9e1'],
    [0.625, '#72aed2'],
    [0.6667, '#4393c3'],
    [0.7083, '#3b88bd'],
    [0.75, '#327db8'],
    [0.7917, '#2a71b2'],
    [0.8333, '#2166ac'],
    [0.875, '#1a5899'],
    [0.9167, '#134b87'],
    [0.9583, '#0c3e74'],
    [1.0, '#053061'],
  ],
  // HCDP 'Increasing' dark red → light yellow.
  increasing: [
    [0.0, '#800026'],
    [0.05, '#8f0026'],
    [0.1, '#9f0026'],
    [0.15, '#ae0026'],
    [0.2, '#bd0026'],
    [0.25, '#c70723'],
    [0.3, '#d00d21'],
    [0.35, '#da141e'],
    [0.4, '#e31a1c'],
    [0.45, '#e92720'],
    [0.5, '#f03423'],
    [0.55, '#f64126'],
    [0.6, '#fc4e2a'],
    [0.65, '#fc5e2e'],
    [0.7, '#fc6d33'],
    [0.75, '#fd7d37'],
    [0.8, '#fd8d3c'],
    [0.85, '#fda555'],
    [0.9, '#febd6e'],
    [0.95, '#fed587'],
    [1.0, '#ffeda0'],
  ],
  // HCDP 'USGS' 38-stop scheme.
  usgs: [
    [0.0, '#c1523c'],
    [0.0263, '#e1871f'],
    [0.0526, '#eead12'],
    [0.0789, '#f5cf0b'],
    [0.1053, '#fbf801'],
    [0.1316, '#9ef000'],
    [0.1579, '#50e600'],
    [0.1842, '#15dc00'],
    [0.2105, '#09d11e'],
    [0.2368, '#0ec63e'],
    [0.2632, '#13bb57'],
    [0.2895, '#17b268'],
    [0.3158, '#1aac75'],
    [0.3421, '#1ba77d'],
    [0.3684, '#1ea282'],
    [0.3947, '#1f9d87'],
    [0.4211, '#1f988b'],
    [0.4474, '#20958f'],
    [0.4737, '#1f9392'],
    [0.5, '#1d8a92'],
    [0.5263, '#1b808f'],
    [0.5526, '#19778d'],
    [0.5789, '#176f8b'],
    [0.6053, '#156888'],
    [0.6316, '#146386'],
    [0.6579, '#145e86'],
    [0.6842, '#135885'],
    [0.7105, '#125384'],
    [0.7368, '#114e82'],
    [0.7632, '#104981'],
    [0.7895, '#0f4580'],
    [0.8158, '#0f417f'],
    [0.8421, '#0e3b7c'],
    [0.8684, '#0e397c'],
    [0.8947, '#0c357a'],
    [0.9211, '#0c337a'],
    [0.9474, '#0c317a'],
    [0.9737, '#102f7a'],
    [1.0, '#7a3090'],
  ],
  // HCDP 'TACC 3-wave' (ParaView XML 4-3wbgy.xml).
  tacc3: [
    [0.0, '#bfe7ee'],
    [0.0, '#bfe7ee'],
    [0.016, '#a2d2de'],
    [0.0319, '#93c4d5'],
    [0.0638, '#7baac3'],
    [0.0957, '#6790b1'],
    [0.1277, '#55789f'],
    [0.1596, '#46648e'],
    [0.1915, '#384f7a'],
    [0.2234, '#283962'],
    [0.2553, '#1c284e'],
    [0.2872, '#101331'],
    [0.3192, '#0e1c1f'],
    [0.3375, '#132b2d'],
    [0.3559, '#163937'],
    [0.3742, '#18453e'],
    [0.3925, '#1b5445'],
    [0.4109, '#1d6247'],
    [0.4292, '#1e6e46'],
    [0.4476, '#1e7941'],
    [0.4659, '#1e8139'],
    [0.4843, '#1d882f'],
    [0.5026, '#1a9021'],
    [0.521, '#179913'],
    [0.5393, '#23a40f'],
    [0.5576, '#3baf16'],
    [0.576, '#55b91e'],
    [0.5943, '#70c22a'],
    [0.6127, '#8ecc3d'],
    [0.631, '#a8d54a'],
    [0.6494, '#c4df61'],
    [0.6677, '#dde981'],
    [0.686, '#f0f0a2'],
    [0.6861, '#fbf9b1'],
    [0.6861, '#fbf9b1'],
    [0.6867, '#fbf9b0'],
    [0.7026, '#faf49f'],
    [0.7191, '#f9ee8c'],
    [0.7356, '#f7e578'],
    [0.7522, '#f7db62'],
    [0.7687, '#f5ce4b'],
    [0.7852, '#f3c03c'],
    [0.8017, '#f1b32c'],
    [0.8182, '#eea41f'],
    [0.8348, '#ec9514'],
    [0.8513, '#ea870d'],
    [0.8678, '#e77908'],
    [0.8843, '#e36805'],
    [0.9009, '#ce5100'],
    [0.9174, '#c44100'],
    [0.9339, '#b53302'],
    [0.9504, '#a32705'],
    [0.967, '#8f1907'],
    [0.9835, '#790d0a'],
    [1.0, '#630a10'],
  ],
  // HCDP 'TACC 4-wave' (13-4w_grphgrnl.xml).
  tacc4: [
    [0.0, '#f0f0e4'],
    [0.01, '#e3e3d2'],
    [0.0123, '#e0e0ce'],
    [0.02, '#d7d7c3'],
    [0.0246, '#d1d1bc'],
    [0.03, '#cdcdb8'],
    [0.0369, '#c9c8b3'],
    [0.04, '#c6c5b0'],
    [0.0492, '#bfbda8'],
    [0.05, '#bebca7'],
    [0.06, '#b4b29d'],
    [0.0615, '#b3b09b'],
    [0.07, '#aaa793'],
    [0.0738, '#a6a390'],
    [0.08, '#a19d8b'],
    [0.0861, '#9c9786'],
    [0.09, '#999483'],
    [0.0984, '#948e7e'],
    [0.1, '#938d7d'],
    [0.11, '#8b8475'],
    [0.1107, '#8a8374'],
    [0.12, '#847c6f'],
    [0.123, '#827a6d'],
    [0.13, '#7f776a'],
    [0.14, '#7b7266'],
    [0.1476, '#786e63'],
    [0.15, '#776d62'],
    [0.1599, '#73685e'],
    [0.16, '#73685e'],
    [0.17, '#6c6159'],
    [0.18, '#665a53'],
    [0.1845, '#635751'],
    [0.19, '#61554f'],
    [0.2, '#5e504c'],
    [0.2089, '#5c4c49'],
    [0.21, '#5b4c48'],
    [0.22, '#594946'],
    [0.2265, '#574645'],
    [0.23, '#564544'],
    [0.24, '#534241'],
    [0.246, '#52413f'],
    [0.2461, '#54413e'],
    [0.25, '#5a4440'],
    [0.26, '#694b46'],
    [0.2696, '#78524c'],
    [0.27, '#78524c'],
    [0.28, '#84584c'],
    [0.29, '#905d4d'],
    [0.2932, '#945f4d'],
    [0.3, '#9a634d'],
    [0.31, '#a2684d'],
    [0.3167, '#a86c4d'],
    [0.32, '#ab6e4e'],
    [0.33, '#b2754f'],
    [0.34, '#ba7c50'],
    [0.3403, '#ba7c50'],
    [0.35, '#c08753'],
    [0.36, '#c79256'],
    [0.3639, '#c99657'],
    [0.37, '#cc9b59'],
    [0.38, '#d0a55e'],
    [0.3874, '#d4ac61'],
    [0.39, '#d5ae64'],
    [0.4, '#d9b96d'],
    [0.41, '#ddc377'],
    [0.411, '#dec478'],
    [0.42, '#e1cb80'],
    [0.43, '#e4d288'],
    [0.4345, '#e6d68c'],
    [0.44, '#e8d892'],
    [0.45, '#ebde9c'],
    [0.46, '#eee3a7'],
    [0.4684, '#f0e7af'],
    [0.47, '#f0e9b1'],
    [0.48, '#f3f3bf'],
    [0.49, '#f6fecd'],
    [0.4912, '#f6ffcf'],
    [0.5, '#eefdc2'],
    [0.51, '#e6fab4'],
    [0.5182, '#def7a8'],
    [0.52, '#dcf7a5'],
    [0.53, '#cef396'],
    [0.54, '#c0ef86'],
    [0.5483, '#b4ec78'],
    [0.55, '#b1eb74'],
    [0.56, '#a1e45b'],
    [0.568, '#94de45'],
    [0.57, '#92dd43'],
    [0.58, '#86d73b'],
    [0.59, '#7ad232'],
    [0.6, '#6ecc29'],
    [0.6002, '#6dcc28'],
    [0.61, '#5bc422'],
    [0.62, '#46bc1a'],
    [0.6251, '#39b816'],
    [0.63, '#33b416'],
    [0.64, '#25ab15'],
    [0.6469, '#19a615'],
    [0.65, '#19a419'],
    [0.66, '#189e24'],
    [0.67, '#17982d'],
    [0.6718, '#17962e'],
    [0.68, '#1a8e36'],
    [0.69, '#1b843e'],
    [0.6915, '#1b823f'],
    [0.7, '#1f7b47'],
    [0.71, '#21744f'],
    [0.7113, '#217350'],
    [0.72, '#216950'],
    [0.7299, '#215e50'],
    [0.73, '#215e50'],
    [0.74, '#20564e'],
    [0.75, '#1f4d4c'],
    [0.7507, '#1f4c4c'],
    [0.76, '#22474d'],
    [0.77, '#24414e'],
    [0.7756, '#253e4f'],
    [0.78, '#2b4158'],
    [0.788, '#344769'],
    [0.79, '#35486b'],
    [0.8, '#3b5075'],
    [0.81, '#415880'],
    [0.8115, '#425a82'],
    [0.82, '#47618a'],
    [0.83, '#4d6a94'],
    [0.8351, '#506f99'],
    [0.84, '#53739c'],
    [0.85, '#5b7ca3'],
    [0.8586, '#6284a8'],
    [0.86, '#6385a9'],
    [0.87, '#6a8fb1'],
    [0.88, '#7298b8'],
    [0.8822, '#739bba'],
    [0.89, '#79a1be'],
    [0.9, '#7faac4'],
    [0.9058, '#83aec7'],
    [0.91, '#86b2c9'],
    [0.92, '#8ebacd'],
    [0.9293, '#94c1d1'],
    [0.93, '#95c2d1'],
    [0.94, '#9dc8d6'],
    [0.95, '#a4d0da'],
    [0.9529, '#a7d2db'],
    [0.96, '#acd5de'],
    [0.97, '#b3dbe1'],
    [0.9764, '#b8dee3'],
    [0.98, '#bce0e4'],
    [0.99, '#c9e7e9'],
    [1.0, '#d5eded'],
  ],
  // HCDP 'TACC 5-wave' (17-5wdkcool.xml).
  tacc5: [
    [0.0, '#4c3831'],
    [0.0167, '#663e35'],
    [0.0333, '#784136'],
    [0.05, '#8e4934'],
    [0.0667, '#a25f3a'],
    [0.0833, '#ab713e'],
    [0.1, '#b28747'],
    [0.1167, '#c2a25d'],
    [0.1333, '#cfae72'],
    [0.15, '#d9be8f'],
    [0.1667, '#e0cca4'],
    [0.1833, '#e1e3c1'],
    [0.2, '#d7e09c'],
    [0.2167, '#d8e084'],
    [0.2333, '#cbcf6a'],
    [0.25, '#babd51'],
    [0.2667, '#aaae3c'],
    [0.2833, '#9c9f2e'],
    [0.3, '#8c9120'],
    [0.3167, '#777f14'],
    [0.3333, '#67720b'],
    [0.35, '#586705'],
    [0.3667, '#485c03'],
    [0.3833, '#3a5302'],
    [0.4, '#2f4c01'],
    [0.4167, '#29472c'],
    [0.4333, '#305e3b'],
    [0.45, '#2f7041'],
    [0.4667, '#2d853c'],
    [0.4833, '#2c912e'],
    [0.5, '#43a336'],
    [0.5167, '#5fb245'],
    [0.5333, '#7bc95f'],
    [0.55, '#9ad679'],
    [0.5667, '#aee597'],
    [0.5833, '#cbf2b6'],
    [0.6, '#dbf5da'],
    [0.6167, '#c0f2da'],
    [0.6333, '#a2e6d1'],
    [0.65, '#84d6c6'],
    [0.6667, '#63c7b0'],
    [0.6833, '#44b59f'],
    [0.7, '#30a89a'],
    [0.7167, '#219e99'],
    [0.7333, '#168d91'],
    [0.75, '#0e7685'],
    [0.7667, '#08637a'],
    [0.7833, '#03506e'],
    [0.8, '#01466b'],
    [0.8167, '#343461'],
    [0.8333, '#343573'],
    [0.85, '#373c8a'],
    [0.8667, '#344494'],
    [0.8833, '#3551a1'],
    [0.9, '#406bb5'],
    [0.9167, '#4d83c2'],
    [0.9333, '#5f9bcf'],
    [0.95, '#73afd6'],
    [0.9667, '#8fc9e8'],
    [0.9833, '#a3d2eb'],
    [1.0, '#d9ecfc'],
  ],
}

// Default colormap per datatype when the spec doesn't name one — a verbatim
// mirror of _DEFAULT_COLORMAP in chatbot/raster_spec.py (which stamps these
// into AI-built specs; this is the fallback for colormap-less specs so the two
// layers can't disagree). Every product opens on the HCDP portal's own
// default scheme — its Viridis, run yellow = low → purple = high for
// rainfall, humidity, NDVI and SPI, and reversed (purple = low) for
// temperature and ignition probability, exactly as the portal's dataset
// table sets `reverse` (dataset-form-manager.service.ts).
export const DEFAULT_COLORMAP_BY_DATATYPE = {
  rainfall: 'viridis_r',
  temperature: 'viridis',
  relative_humidity: 'viridis_r',
  ndvi_modis: 'viridis_r',
  ignition_probability: 'viridis',
  spi: 'viridis_r',
}

// HCDP portal fixed legend domains — the portal pins every product to a fixed
// range (dataset-form-manager.service.ts) so days/months and datasets read
// comparably: rainfall 0–650 mm monthly / 0–20 mm daily, temperature
// −10…35 °C, humidity 0–100 %, NDVI −0.2…1, ignition 0–1, SPI −3…3. Values
// beyond the ends clamp into the end colours exactly like the portal's
// over-scale rendering. Null for derived rasters (no portal counterpart).
export function portalDomainFor(spec) {
  const ds = portalDataset(spec)
  return ds ? { min: ds.range[0], max: ds.range[1] } : null
}

/** The portal's "extreme value scale" (daily rainfall 0–250 mm), or null. */
export function portalExtremeDomainFor(spec) {
  const ds = portalDataset(spec)
  return ds?.extreme ? { min: ds.extreme[0], max: ds.extreme[1] } : null
}

/** The colormap actually in effect for a spec (respecting per-datatype default). */
export function resolveColormap(spec) {
  return spec?.colormap || DEFAULT_COLORMAP_BY_DATATYPE[spec?.datatype] || spec?.datatype
}

/** The HCDP-portal ramp for a spec's datatype — the map viewer's DEFAULT
 *  regardless of what colormap the AI stamped into the spec (portal parity
 *  first; the AI's pick stays one click away in the Colors selector). */
export function portalColormapFor(spec) {
  return DEFAULT_COLORMAP_BY_DATATYPE[spec?.datatype] || resolveColormap(spec)
}

export function rampFor(spec) {
  return NAMED_RAMPS[resolveColormap(spec)] || NAMED_RAMPS.rainfall
}

// The colormap picker's option list — single source so every surface matches.
// HCDP schemes are labeled so the portal parity is discoverable.
export const COLORMAP_OPTIONS = [
  { value: 'viridis_r', label: 'Viridis — HCDP default (yellow = low)' },
  { value: 'viridis', label: 'Viridis reversed (purple = low)' },
  { value: 'monochromatic', label: 'Monochromatic (HCDP)' },
  { value: 'usgs', label: 'USGS (HCDP)' },
  { value: 'turbo', label: 'Turbo (HCDP)' },
  { value: 'diverging', label: 'Diverging (HCDP)' },
  { value: 'tacc3', label: 'TACC 3-wave (HCDP)' },
  { value: 'tacc4', label: 'TACC 4-wave (HCDP)' },
  { value: 'tacc5', label: 'TACC 5-wave (HCDP)' },
  { value: 'nwsradar', label: 'NWS Radar (HCDP)' },
  { value: 'increasing', label: 'Increasing (HCDP)' },
  { value: 'rainfall', label: 'Rainfall blues' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'ylgnbu', label: 'YlGnBu' },
  { value: 'ylorrd', label: 'YlOrRd' },
  { value: 'rdylgn', label: 'RdYlGn' },
  { value: 'magma', label: 'Magma' },
]

/** Backend proxy URL for one frame of the spec. */
export function rasterUrl(spec, date) {
  // QGIS-published rasters live in the local derived store. Each frame is a
  // separate stored tif keyed by its own derived_id; there is no date/extent
  // query (the "date" is just a frame label).
  if (spec?.datatype === 'derived') {
    // Animation: derived_ids[] runs parallel to dates[] — map the requested
    // frame's label back to its index, then to that frame's derived_id.
    let id = spec.derived_id || ''
    if (Array.isArray(spec.derived_ids) && spec.derived_ids.length) {
      const idx = Array.isArray(spec.dates) ? spec.dates.indexOf(date) : -1
      id = spec.derived_ids[idx >= 0 ? idx : 0] || spec.derived_ids[0]
    }
    return `/api/raster/derived/${encodeURIComponent(id)}`
  }
  // Each datatype takes a different qualifier; send only the one that applies
  // (the proxy mirrors this). period drives the date format (day vs month).
  const params = new URLSearchParams({ period: spec.period || 'month' })
  if (spec.production) params.set('production', spec.production)
  if (spec.aggregation) params.set('aggregation', spec.aggregation)
  if (spec.timescale != null) params.set('timescale', String(spec.timescale))
  if (spec.lead > 0) params.set('lead', String(spec.lead))
  return `/api/raster/${encodeURIComponent(spec.datatype)}/${encodeURIComponent(spec.extent)}/${encodeURIComponent(date)}?${params}`
}

/** Leaflet [[s,w],[n,e]] bounds: explicit focus > island extent > statewide. */
export function leafletBoundsForSpec(spec) {
  const f = spec?.focus
  if (f && [f.minlat, f.minlng, f.maxlat, f.maxlng].every(v => typeof v === 'number')) {
    return [[f.minlat, f.minlng], [f.maxlat, f.maxlng]]
  }
  const islandKey = spec?.extent === 'statewide'
    ? 'all'
    : EXTENT_TO_ISLAND[spec?.extent] || 'all'
  return ISLAND_BOUNDS[islandKey] || ISLAND_BOUNDS.all
}

/** True when the pixel value passes the spec's threshold (or no threshold). */
export function passesThreshold(threshold, v) {
  if (!threshold) return true
  const { op, value } = threshold
  if (op === 'lt') return v < value
  if (op === 'lte') return v <= value
  if (op === 'gt') return v > value
  if (op === 'gte') return v >= value
  return true
}

/**
 * Build the pixelValuesToColorFn for a GeoRasterLayer.
 *
 * - single/animation/compare panes: values[0] is the frame's pixel.
 * - difference mode: the layer is constructed with BOTH georasters, so
 *   values = [a, b] and we color a - b on a diverging ramp centered at 0.
 * - threshold: failing pixels return null (transparent) — that's the
 *   "highlight only areas under 50 mm" behavior.
 *
 * `domain` is {min, max}; for difference mode it should be symmetric
 * around zero (see differenceDomain).
 */
export function makeColorFn(spec, domain, noDataValue, stretch = 'linear') {
  const ramp = rampFor(spec)
  const { min, max } = domain
  const isDiff = spec.mode === 'difference'
  const mode = stretchFor(spec, stretch)

  return (values) => {
    let v
    if (isDiff) {
      const [a, b] = values
      if (isNoData(a, noDataValue) || isNoData(b, noDataValue)) return null
      v = a - b
    } else {
      v = values[0]
      if (isNoData(v, noDataValue)) return null
    }
    if (!passesThreshold(spec.threshold, v)) return null
    return interpolateColorRamp(ramp, stretchT(v, min, max, mode))
  }
}

/**
 * Color a single scalar value on the spec's ramp + domain — the same
 * normalization makeColorFn uses for pixels, minus the nodata/threshold
 * gates. Used to paint explicit station-point markers (`spec.station_points`
 * with a `value`) on the identical scale as the grid, so a gauge reading and
 * the interpolated surface beneath it are directly comparable. Returns null
 * for a missing/non-finite value (marker falls back to a neutral fill).
 */
export function colorForValue(spec, domain, value, stretch = 'linear') {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) return null
  const ramp = rampFor(spec)
  const { min, max } = domain || {}
  return interpolateColorRamp(ramp, stretchT(value, min, max, stretchFor(spec, stretch)))
}

/** True when a pixel value should be treated as no-data.
 *
 * Catches three cases: explicit `noDataValue`, JS null/NaN, and — critically —
 * the 32-bit float min/max sentinels (~±3.4e38) GDAL writes as nodata in
 * HCDP GeoTIFFs. Some georaster builds report the embedded NODATA tag in
 * `noDataValue` but still include those pixels in `mins[0]`/`maxs[0]`, which
 * collapses the color domain to a single hue and makes the map look like
 * one wash. Guard here so callers can't miss it.
 */
function isNoData(v, noDataValue) {
  if (v == null || Number.isNaN(v)) return true
  if (noDataValue != null && v === noDataValue) return true
  return v <= -1e30 || v >= 1e30
}

/**
 * Real stats for a parsed georaster, scanning the pixel grid and excluding
 * no-data values. Returns `{min, max, p05, p98}` — the percentiles power
 * the auto color domain (a single extreme pixel must not own the whole
 * ramp). ~10–50ms per frame for typical HCDP rasters; memoize the result
 * at the call site (RasterSpecMap does, so per-render cost is zero).
 *
 * Returns `null` if every pixel is nodata.
 */
export function realStatsOf(georaster) {
  const grid = georaster?.values?.[0]
  if (!Array.isArray(grid)) return null
  const noData = georaster.noDataValue
  const valid = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (!isNoData(v, noData)) valid.push(v)
    }
  }
  if (!valid.length) return null
  let sum = 0
  for (const v of valid) sum += v
  valid.sort((a, b) => a - b)
  const q = (p) => valid[Math.round(p * (valid.length - 1))]
  return {
    min: valid[0],
    max: valid[valid.length - 1],
    mean: sum / valid.length,
    p05: q(0.05),
    p98: q(0.98),
  }
}

/**
 * Normalization stretch for the spec. The HCDP portal paints every product
 * LINEARLY on its fixed range, so linear is the default for every map. The
 * portal's other option — a pseudo-log, sign(v)·log1p(|v|), applied to the
 * value and to the range ends alike — is the "Log" toggle for heavy-tailed
 * rainfall (the tick labels stay linear; only the colours spread). 'sqrt'
 * survives as the legacy stretch for anything that still asks for it.
 * Difference maps stay linear so the diverging midpoint keeps meaning "no
 * change".
 */
export const STRETCH_OPTIONS = [
  { value: 'linear', label: 'Linear (HCDP default)' },
  { value: 'log', label: 'Pseudo-log (HCDP option)' },
]
export function stretchFor(spec, chosen = 'linear') {
  if (spec?.mode === 'difference') return 'linear'
  return chosen === 'log' || chosen === 'sqrt' ? chosen : 'linear'
}

/** The portal's pseudo-log: symmetric about zero, finite at zero. */
export function pseudoLog(v) {
  return Math.sign(v) * Math.log1p(Math.abs(v))
}

/** Ramp position (0–1) of a value on the domain under a stretch — the ONE
 *  normalization every renderer shares (legend, markers, georaster layer,
 *  WebXR mesh, and raster_tiles._normalize on the server). */
export function stretchT(value, min, max, stretch = 'linear') {
  if (stretch === 'log') {
    const a = pseudoLog(min)
    const b = pseudoLog(max)
    const r = (b - a) || 1
    return Math.max(0, Math.min(1, (pseudoLog(value) - a) / r))
  }
  const range = (max - min) || 1
  const t = Math.max(0, Math.min(1, (value - min) / range))
  return stretch === 'sqrt' ? Math.sqrt(t) : t
}

/**
 * Color-scale domain for a set of frames given their real per-frame stats
 * (computed via realStatsOf — NOT georaster.mins/maxs, which include the
 * float-min nodata sentinel and collapse the ramp). Spec vmin/vmax win;
 * otherwise the union of frame mins/maxs so animation colors stay stable
 * across frames instead of re-normalizing per frame.
 *
 * `realStats` is `[{min,max} | null, ...]` parallel to the frames array.
 */
export function sharedDomain(spec, realStats) {
  const stats = (realStats || []).filter(Boolean)
  // Auto-domain uses the p05..p98 envelope (falling back to min/max when
  // percentiles are absent) so one extreme pixel can't own the ramp —
  // values outside are clamped to the end colors, which is standard
  // choropleth practice. Explicit spec vmin/vmax always win.
  const lows = stats.map(s => s.p05 ?? s.min)
  const highs = stats.map(s => s.p98 ?? s.max)
  let min = typeof spec?.vmin === 'number'
    ? spec.vmin
    : (lows.length ? Math.min(...lows) : 0)
  let max = typeof spec?.vmax === 'number'
    ? spec.vmax
    : (highs.length ? Math.max(...highs) : 1)
  // Degenerate clip (near-constant field) — fall back to the raw extent.
  if (!(max > min) && stats.length) {
    min = Math.min(...stats.map(s => s.min))
    max = Math.max(...stats.map(s => s.max))
  }
  return { min, max }
}

/** Raw (unclipped) value extent across frames — used by the legend to mark
 *  the ends with ≤/≥ when the auto-domain clipped outliers. */
export function rawExtent(realStats) {
  const stats = (realStats || []).filter(Boolean)
  if (!stats.length) return null
  return {
    min: Math.min(...stats.map(s => s.min)),
    max: Math.max(...stats.map(s => s.max)),
  }
}

/** Symmetric-about-zero domain for difference maps so white = "no change".
 *  Takes real per-frame stats (see realStatsOf), not raw georaster meta. */
export function differenceDomain(statsA, statsB) {
  const lo = Math.min(statsA?.min ?? 0, statsB?.min ?? 0)
  const hi = Math.max(statsA?.max ?? 1, statsB?.max ?? 1)
  const mag = Math.max(Math.abs(hi - lo), Math.abs(hi), Math.abs(lo)) || 1
  return { min: -mag, max: mag }
}

/**
 * Read the raster value at a lat/lng. Returns null outside the raster or
 * on nodata. Pure pixel math against the georaster's georeferencing —
 * this is what makes click-to-inspect free (no server round trip).
 */
export function valueAtLatLng(georaster, lat, lng) {
  if (!georaster) return null
  const { xmin, ymax, pixelWidth, pixelHeight, width, height, noDataValue } = georaster
  const col = Math.floor((lng - xmin) / pixelWidth)
  const row = Math.floor((ymax - lat) / pixelHeight)
  if (col < 0 || row < 0 || col >= width || row >= height) return null
  const v = georaster.values?.[0]?.[row]?.[col]
  if (isNoData(v, noDataValue)) return null
  return v
}

/** Human label for one frame ("2026-03") of the spec. */
export function frameLabel(spec, idx) {
  const date = spec?.dates?.[idx] ?? ''
  return date
}

const _DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Human frame date, period-aware (T5A): a day reads 'Thu 08/14/2026', a month
 * 'Aug 2026'; anything else (derived labels, 'latest') comes back verbatim.
 */
export function formatFrameDate(period, date) {
  const s = String(date ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return `${_DOW[dt.getUTCDay()]} ${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number)
    return `${_MON[m - 1] || m} ${y}`
  }
  return s
}

/** The frame readout with its unit: 'Thu 08/14/2026 · day 2 of 3'. */
export function frameReadout(spec, idx, resolvedDate) {
  const date = resolvedDate || spec?.dates?.[idx]
  const period = spec?.period === 'day' ? 'day' : 'month'
  const n = spec?.dates?.length || 0
  const base = formatFrameDate(period, date)
  const out = n > 1 ? `${base} · ${period} ${idx + 1} of ${n}` : base
  // Ignition forecasts: the frame date is the issue date, the map its outlook.
  return spec?.lead > 0 ? `${out} · +${spec.lead}-day forecast` : out
}

// ── Server-rendered tile path ────────────────────────────────────────────────
//
// When tiles are available the map shows server-rendered 256px XYZ tiles in a
// plain Leaflet TileLayer (smooth zoom/pan) instead of reprojecting a full
// GeoTIFF in JS. The value/stat reads that used valueAtLatLng/realStatsOf then
// come from the backend (stats/sample/sample_batch). These helpers build those
// URLs, mirroring rasterUrl's per-datatype param shape. The colormap/domain go
// in the tile URL so colormap switching is a tile re-request (not a refetch of
// data); the legend domain still comes from sharedDomain/differenceDomain fed
// by the stats endpoint.

// Datatypes proven on the tile path. Derived (QGIS-published) rasters keep the
// client georaster path — they're single local tifs with no proxy params — so
// the gate also excludes them explicitly.
export const TILE_DATATYPES = new Set([
  'rainfall', 'temperature', 'relative_humidity',
  'ndvi_modis', 'ignition_probability', 'spi',
])

/** Should this spec render via server tiles? Gated on an explicit `tiles`
 *  opt-in in the spec (set by the builder for supported datatypes) so any spec
 *  without it — and every legacy/derived spec — falls back to the client
 *  georaster layer and nothing regresses. */
export function tilesEnabled(spec) {
  return spec?.tiles === true
    && spec?.datatype !== 'derived'
    && TILE_DATATYPES.has(spec?.datatype)
}

/** Per-datatype product qualifiers shared by every tile/stats/sample URL —
 *  the same shape rasterUrl sends (the proxy mirrors it). Mutates and returns
 *  the passed URLSearchParams. */
function appendProductParams(params, spec) {
  params.set('period', spec.period || 'month')
  if (spec.production) params.set('production', spec.production)
  if (spec.aggregation) params.set('aggregation', spec.aggregation)
  if (spec.timescale != null) params.set('timescale', String(spec.timescale))
  // Ignition forecasts: which day ahead of the issue date (0 = today's run).
  if (spec.lead > 0) params.set('lead', String(spec.lead))
  return params
}

const enc = encodeURIComponent

/** XYZ tile template for one frame, with the colormap + domain (vmin/vmax) +
 *  stretch + threshold baked into the query. Leaflet substitutes {z}/{x}/{y}. */
export function tileUrlTemplate(spec, date, domain, stretch = 'linear') {
  const params = appendProductParams(new URLSearchParams(), spec)
  params.set('colormap', spec.colormap)
  params.set('vmin', String(domain?.min ?? 0))
  params.set('vmax', String(domain?.max ?? 1))
  const mode = stretchFor(spec, stretch)
  if (mode !== 'linear') params.set('stretch', mode)
  if (spec.threshold) {
    params.set('threshold_op', spec.threshold.op)
    params.set('threshold_value', String(spec.threshold.value))
  }
  return `/api/raster/tiles/${enc(spec.datatype)}/${enc(spec.extent)}/${enc(date)}/{z}/{x}/{y}.png?${params}`
}

/** XYZ tile template for difference mode (dates[0] − dates[1]); the server
 *  forces the portal's diverging ramp, so only the symmetric domain is sent. */
export function tileDiffUrlTemplate(spec, domain) {
  const params = appendProductParams(new URLSearchParams(), spec)
  params.set('vmin', String(domain?.min ?? -1))
  params.set('vmax', String(domain?.max ?? 1))
  const [a, b] = spec.dates
  return `/api/raster/tiles/diff/${enc(spec.datatype)}/${enc(spec.extent)}/${enc(a)}/${enc(b)}/{z}/{x}/{y}.png?${params}`
}

/** Stats endpoint for one frame → {stats:{min,max,p05,p98}|null}. Style-free
 *  (no colormap/vmin) — the domain is colormap-independent, so a colormap
 *  switch never re-requests stats. */
export function statsUrl(spec, date) {
  const params = appendProductParams(new URLSearchParams(), spec)
  return `/api/raster/stats/${enc(spec.datatype)}/${enc(spec.extent)}/${enc(date)}?${params}`
}

/** Spatial-mean series across all the spec's dates → {series:[{date,mean}]}.
 *  Backs the animation time scrubber; style-free like statsUrl. */
export function seriesUrl(spec) {
  const params = appendProductParams(new URLSearchParams(), spec)
  params.set('dates', (spec.dates || []).join(','))
  return `/api/raster/series/${enc(spec.datatype)}/${enc(spec.extent)}?${params}`
}

/** Point-sample endpoint for click-inspect / single station → {value}. */
export function sampleUrl(spec, date, lat, lng) {
  const params = appendProductParams(new URLSearchParams(), spec)
  params.set('lat', String(lat))
  params.set('lng', String(lng))
  return `/api/raster/sample/${enc(spec.datatype)}/${enc(spec.extent)}/${enc(date)}?${params}`
}

/** Two-date point-sample for difference-mode inspect → {value: a-b}. */
export function sampleDiffUrl(spec, lat, lng) {
  const params = appendProductParams(new URLSearchParams(), spec)
  params.set('lat', String(lat))
  params.set('lng', String(lng))
  const [a, b] = spec.dates
  return `/api/raster/sample/diff/${enc(spec.datatype)}/${enc(spec.extent)}/${enc(a)}/${enc(b)}?${params}`
}

/** POST body for the batch sampler (station markers in one request). */
export function sampleBatchBody(spec, date, points) {
  // Only the qualifiers that apply are sent — a `production: null` (every
  // temperature/humidity/NDVI spec) fails the server's string validation
  // and left every station marker white once markers were on by default.
  const body = {
    variable: spec.datatype,
    extent: spec.extent,
    date,
    period: spec.period || 'month',
    points: points.map(p => ({ lat: p.lat, lng: p.lng })),
  }
  if (spec.production) body.production = spec.production
  if (spec.aggregation != null) body.aggregation = spec.aggregation
  if (spec.timescale != null) body.timescale = spec.timescale
  if (spec.lead > 0) body.lead = spec.lead
  return body
}

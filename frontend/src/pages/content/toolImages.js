// The portal's tool pictures by tool slug (the slug is the image's file name, and /tools/<slug> the tile's
// address), shared by the Climate Tools page and the assistant's did-you-mean tiles (R5 C, 13 Oct). The
// pictures are the portal's own, in public/tools/; the five over 400 KB were re-saved as optimized PNGs
// (their alpha channels were fully opaque) and the American Samoa screenshot scaled from 1817 to 1600 px
// wide. Width and height are the files' own, so the browser reserves the space before they load. The AI
// Data Analysis Tool picture is ours: the AI interface's sign-in page (captured 2026-10-08, 3:2, 800 px).
const img = (file, width, height) => ({ src: `/tools/${file}`, width, height, slug: file.replace(/\.[a-z]+$/, '') })

export const TOOL_IMAGES = {
  'rainfall-atlas': img('rainfall-atlas.jpg', 663, 500),
  'ccvd-portfolios': img('ccvd-portfolios.png', 800, 530),
  'h-rip': img('h-rip.jpg', 663, 500),
  'groundwater-recharge': img('groundwater-recharge.jpg', 663, 500),
  'monthly-climate-summary': img('monthly-climate-summary.png', 800, 406),
  'sea-level-rise-viewer': img('sea-level-rise-viewer.png', 663, 500),
  'american-samoa-data-viewer': img('american-samoa-data-viewer.png', 800, 395),
  'soest-coastal-viewer': img('soest-coastal-viewer.jpg', 663, 500),
  'climate-of-hawaii': img('climate-of-hawaii.jpg', 663, 414),
  'ai-data-analysis': { src: '/tiles/ai-data-analysis.jpg', width: 800, height: 533, slug: 'ai-data-analysis' },
  'avian-malaria': img('avian-malaria.png', 301, 209),
}

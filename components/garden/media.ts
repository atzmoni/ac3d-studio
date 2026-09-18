/**
 * Where the photography goes.
 *
 * Every picture on the storefront is looked up here by name. `MEDIA` is the
 * real photography: drop a file into `public/media/`, name it below, and it
 * appears — nothing else has to change and nothing moves on the page.
 *
 * `GENERATED` is the stand-in underneath it, written by
 * `scripts/render-garden-media.ts`: pots drawn from the actual planter engine,
 * so an internal run has something true to look at instead of grey plates. A
 * real photograph always wins over a generated one, so filling in `MEDIA` is
 * all it takes to retire a stand-in — there is nothing to delete.
 *
 * The comments name the shots the brand already has, so each file lands in the
 * slot it was framed for.
 */
import { GENERATED } from './media-generated';

export const MEDIA: Record<string, string> = {
  /** The opening clip: a pot sketched on a napkin with its flat net drawn
   *  underneath, turning into that pot on the bench, and then a pair of hands
   *  painting it. Silent, portrait, and looping across a crossfade seam, so it
   *  runs idea → object → idea for as long as anyone watches — the business in
   *  one sentence, including the part that is done by hand.
   *  Cut by `scripts/encode-hero.sh` from the master in `media-source/`. */
  hero: '/media/napkin-fold.mp4',
  /** The whole range in blue / green / yellow / red, every size, on white. */
  rangeColours: '/media/range-colours.jpg',
  /** The person who answers the phone. Square, tight crop. Still the brand
   *  mark: none of the supplied images is a portrait of whoever that is. */
  contact: '',

  // Blog plates. Post 3 keeps its drawn section — no photograph here shows
  // drainage, and a pretty but off-topic picture is worse than a diagram.
  'post-1': '/media/workshop-cnc.jpg',
  'post-2': '/media/pot-and-net.jpg',

  // The Instagram row is the one place that carries brand pictures without
  // claiming a model or a measurement, so the studio and key-visual shots go
  // here rather than into catalogue tiles they do not match.
  'insta-1': '/media/keyvisual-red.jpg',
  'insta-2': '/media/keyvisual-chrome.jpg',
  'insta-3': '/media/studio-interior.jpg',
  'insta-4': '/media/designer-desk-app.jpg',
  'insta-5': '/media/designer-laptop-net.jpg',
  'insta-6': '/media/napkin-sketch.jpg',

  /** Gold mirror hex pot standing beside its flat cut net. Square. */
  productHexDiamond: '',
  /** Red faceted pot with its development drawing behind it. Square. */
  productRed: '',
  /** Chrome 40 × 50 cm pot with the RAL fan and the CAD screen. Square. */
  productChrome: '',
};

/**
 * Where to crop from, for the pictures whose subject is off to one side.
 *
 * Every one of these is a wide scene going into a narrower box, so something
 * gets cut. This says what to keep: the pot, not the wall behind it.
 */
const FOCUS: Record<string, string> = {
  // The hero clip is 9:16 going into a box that is roughly square on a desktop
  // and frankly wide on a phone, so the crop is severe and it is vertical.
  // Low, because the subject of this one is not only the pot: the flat net is
  // drawn on the napkin below it, and losing that loses the point.
  hero: '50% 55%',
  'post-1': '56% 50%',
  // Both key visuals are 1139 × 928 going into a square, so an eighteenth of
  // the width has to go, and both carry the brand lockup hard against the top
  // right. Flush right, then: the lockup survives whole and what goes is the
  // furniture at the far edge, which is the part that was only ever dressing.
  'insta-1': '100% 50%',
  'insta-2': '100% 46%',
  'insta-3': '44% 56%',
  'insta-4': '54% 50%',
  'insta-5': '46% 52%',
  'insta-6': '46% 46%',
};

/** The crop origin for a slot, or undefined to leave it centred. */
export const mediaFocus = (key: string): string | undefined => (MEDIA[key] ? FOCUS[key] : undefined);

/**
 * The still that stands in for a clip: while it downloads, and permanently for
 * a visitor who has asked for less motion.
 *
 * Each one is its clip's own first frame, written beside it by the encode
 * script — a poster that is a different frame reads as a jump the moment the
 * clip starts, which is worse than no poster at all.
 */
const POSTER: Record<string, string> = {
  hero: '/media/napkin-fold.jpg',
};

/** The holding still for a slot, if that slot holds a clip. */
export const mediaPoster = (key: string): string | undefined => (MEDIA[key] ? POSTER[key] : undefined);

/**
 * The brand's shot list predates the per-model slot names, so three of its
 * photographs were framed for tiles the page now addresses by preset id. This
 * says which; nothing else needs to know about it.
 */
const SHOT_FOR: Record<string, string> = {
  'product-hex-diamond-500': 'productHexDiamond',
  'featured-hex-diamond-500': 'productHexDiamond',
  'featured-hex-crystal-tall': 'productChrome',
  'featured-box-crystal': 'productRed',
};

/** Reads a slot: the real photograph if there is one, the stand-in if not. */
export const media = (key: string): string | undefined =>
  MEDIA[key] || MEDIA[SHOT_FOR[key] ?? ''] || GENERATED[key] || undefined;

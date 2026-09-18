/**
 * Hebrew face of the planter studio.
 *
 * The engine under `planter-engine.ts` stays monolingual on purpose — it is the
 * part that decides geometry, and a shop file has to read the same whoever
 * opened it. Everything here is presentation: the catalogue copy, the control
 * labels and a Hebrew rewrite of the fabrication checks. The check rewrite
 * recomputes its numbers from the model rather than parsing them back out of
 * the English sentence, so the two languages can never drift apart on a
 * dimension.
 */
import { getMaterial } from './pattern-engine';
import { CUSTOM_PALETTE, DEFAULT_GROUT } from './planter-print';
import { getPlanterStyle } from './planter-styles';
import type {
  FabricationCheck, MaterialId, MaterialSpec, PlanterLed, PlanterLedController,
  PlanterLedEffect, PlanterLedPosition, PlanterModel, PlanterPrint, PlanterPrintFit,
  PlanterPrintRule, PlanterStoneSeal, Vec2, Vec3,
} from './types';

// ---------------------------------------------------------------------------
// Catalogue copy
// ---------------------------------------------------------------------------

export const DIFFICULTY_HE: Record<string, string> = {
  Low: 'קלה', Medium: 'בינונית', High: 'מתקדמת',
};

export const CATEGORY_HE: Record<string, string> = {
  all: 'הכול', box: 'תיבה', faceted: 'מפואטת', banded: 'חישוקים', column: 'עמוד', lit: 'מוארת',
};

export const STYLE_HE: Record<string, { name: string; subtitle: string; description: string; applications: string[] }> = {
  prism: {
    name: 'פאה ישרה', subtitle: 'מנסרה או קונוס קטום נקי',
    description: 'הטבעות נשארות מיושרות, כך שכל צד הוא מרובע שטוח אחד — האדנית המחודדת והנקייה שנראית כמו אבן יצוקה.',
    applications: ['לובי', 'חנות', 'מרפסת'],
  },
  crystal: {
    name: 'פאת גביש', subtitle: 'עור משולשים אחיד',
    description: 'כל טבעת מוסטת בחצי פאה, ושוברת את הדופן לעור המשולש בסגנון לואו־פולי שעליו הקטגוריה בנויה.',
    applications: ['אולם תצוגה', 'כניסה'],
  },
  diamond: {
    name: 'תבליט יהלום', subtitle: 'חישוקים גבוהים ונמוכים',
    description: 'הסטה של חצי פאה עם חישוקים שמתחלפים בין גבוה לנמוך — הדופן מקבלת מרקם מעוינים מודגש.',
    applications: ['לובי', 'אולם תצוגה', 'חנות'],
  },
  ripple: {
    name: 'חישוקי אדווה', subtitle: 'צלעות אופקיות עדינות',
    description: 'הרבה חישוקים רדודים ומוסטים מעל מקצב גבהים חד — הדופן מצטלעת לרוחב ותופסת אור מלוכסן.',
    applications: ['מלון', 'מסדרון'],
  },
  spiral: {
    name: 'פאה ספירלית', subtitle: 'פיתול ברבע פאה',
    description: 'כל טבעת מסתובבת רבע פאה, וכך קווי הקיפול מתפתלים במעלה הדופן בלי שהחידוד יעשה את העבודה.',
    applications: ['אולם תצוגה', 'מלון'],
  },
  star: {
    name: 'פאת כוכב', subtitle: 'סיבוב בשלושה צעדים',
    description: 'שליש פאה לכל טבעת מעל מקצב גבהים חזק, כך שקווי הקיפול רודפים זה את זה במעגל ויוצרים פיצוץ כוכב.',
    applications: ['פריט אמנות', 'כניסה'],
  },
};

export const PRESET_HE: Record<string, { name: string; note: string }> = {
  blank: { name: 'התחלה מאפס', note: 'תיבה פשוטה 400 × 300 × 500 מ״מ לבנות עליה' },
  'box-smooth-500': { name: 'תיבה חלקה 500', note: 'פתח 400 × 300 מ״מ, דפנות מחודדות חלקות' },
  'box-cube-400': { name: 'קובייה 400', note: 'דפנות ישרות לגמרי, בלי חידוד' },
  'box-trough': { name: 'שוקת ארוכה', note: '900 מ״מ למעקה מרפסת' },
  'box-twist': { name: 'תיבה מפותלת', note: 'תיבה מרובעת מסובבת 20° מלמעלה למטה' },
  'box-crystal': { name: 'תיבת גביש', note: 'אדנית מרובעת עם מותן מפואטת' },
  'square-taper-500': { name: 'ריבוע מחודד 500', note: 'פתח 400 מ״מ על גוף 500 מ״מ' },
  'hex-diamond-500': { name: 'משושה יהלום 500', note: 'אדנית משושה מרופדת — גיבורת הקטלוג' },
  'hex-crystal-500': { name: 'משושה גביש 500', note: 'פאות אחידות, חידוד עדין' },
  'hex-twist': { name: 'משושה מפותל', note: 'קיפול אחד לכל צד, מסובב 26°' },
  'hex-plain': { name: 'משושה פשוט', note: 'משושה מחודד עם צדדים שטוחים' },
  'penta-crystal': { name: 'מחומש גביש', note: 'אדנית מפואטת בת חמישה צדדים' },
  'hex-star': { name: 'משושה כוכב', note: 'קווי הקיפול רודפים זה את זה בפיצוץ כוכב' },
  'hex-low-bowl': { name: 'קערת משושה נמוכה', note: 'רחבה ונמוכה, לירק על שולחן' },
  'tri-facet': { name: 'משולש מפואט', note: 'אדנית פיסולית בת שלושה צדדים' },
  'hex-barrel': { name: 'חבית משושה', note: 'מותן נפוחה — רק בנייה בחישוקים מחזיקה אותה' },
  'hex-waisted': { name: 'משושה מותניים', note: 'מרכז צבוט, ארבעה חישוקים מסומררים' },
  'octa-barrel': { name: 'חבית מתומנת', note: 'כרס בת שמונה צדדים על פני חמישה חישוקים' },
  'box-barrel': { name: 'תיבת חבית', note: 'אדנית מלבנית עם מרכז נפוח' },
  'hex-diamond-barrel': { name: 'חבית יהלום', note: 'פאות מרופדות על פרופיל נפוח' },
  'hex-crystal-tall': { name: 'משושה גביש גבוה', note: 'עמוד לואו־פולי מחודד' },
  'octa-column': { name: 'עמוד מתומן', note: 'עמוד כניסה דק בן שמונה צדדים' },
  'hex-spiral': { name: 'ספירלת משושה', note: 'הקיפולים מתפתלים רבע פאה לכל חישוק' },
  'octa-ripple': { name: 'אדוות מתומנות', note: 'שמונה צדדים מצולעים לחישוקים עדינים' },
  'hex-ripple': { name: 'אדוות משושה', note: 'משושה מצולע, חמישה חישוקים רדודים' },
  'hex-lumen-500': { name: 'משושה אור 500', note: 'משושה מפואט מכורסם ומואר בשמש' },
  'hex-lumen-bold': { name: 'משושה אור גדול', note: 'משולש אחד גדול לכל פאה — הזריחה הרחבה ביותר' },
  'box-lumen-trough': { name: 'שוקת אור', note: 'שוקת מוארת למרפסת, הפאנל על הצד הארוך' },
};

export const MATERIAL_HE: Record<MaterialId, { name: string; short: string }> = {
  'acp-4': { name: 'אלובונד / קומפוזיט אלומיניום 4 מ״מ', short: 'אלובונד 4 מ״מ' },
  'acp-3': { name: 'אלובונד / קומפוזיט אלומיניום 3 מ״מ', short: 'אלובונד 3 מ״מ' },
  'acrylic-3': { name: 'אקריל 3 מ״מ', short: 'אקריל 3 מ״מ' },
  'steel-2': { name: 'פלדה מוברשת 2 מ״מ', short: 'פלדה 2 מ״מ' },
  'cardboard-2': { name: 'קרטון אדריכלי 2 מ״מ', short: 'קרטון 2 מ״מ' },
};

/**
 * The strips, in Hebrew.
 *
 * `note` is the one line that says what the choice is actually for — a garden
 * pot after dark is a different job from a shop window, and the kelvin number
 * on its own tells nobody which is which.
 */
export const LED_HE: Record<PlanterLed, { name: string; short: string; note: string }> = {
  none: { name: 'בלי פס לד', short: 'ללא', note: 'החלל נשאר ריק — מי שירצה יאיר אותה אחר כך.' },
  '3000k': {
    name: 'לבן חם 3000K', short: '3000K',
    note: 'האור שגינה רוצה בלילה: נופל חם על טיח, על עץ ועל הצמחייה, ומושך הכי מעט חרקים. זו ברירת המחדל.',
  },
  '6000k': {
    name: 'אור יום 6000K', short: '6000K',
    note: 'לבן ניטרלי שמחזיק צבע נכון — טוב לחזית מסחרית או לצילום, קר מדי לפינת ישיבה.',
  },
  '10000k': {
    name: 'קרח 10000K', short: '10000K',
    note: 'הקצה הכחול. נראה כמו אור ירח על מתכת, ונותן את הכי מעט אור לוואט — אפקט, לא מנורה.',
  },
  ws2812: {
    name: 'WS2812 מוען', short: 'WS2812',
    note: 'לא לבן בכלל: RGB עם בקר לכל נורה, ב־5 וולט. כל נורה בנפרד, אז אפשר ריצה, גל או צבע לכל פאה — ומחיר החשמל אחר לגמרי.',
  },
};

export const ledNameHe = (led: PlanterLed) => LED_HE[led]?.name ?? led;

/**
 * מצבי האפקט, באותם שמות בדיוק שבמחולל הניאון.
 *
 * מי שראה את אחד המוצרים לא אמור ללמוד אוצר מילים שני בשביל השני — לכן הרשימה
 * והשמות זהים, וההבדל היחיד הוא שכאן האפקט מקיף אדנית במקום לרוץ לאורך שלט.
 */
export const LED_EFFECT_HE: Record<PlanterLedEffect, string> = {
  static: 'צבע קבוע',
  chase: 'רדיפת צבע',
  rainbow: 'קשת זורמת',
  breathe: 'נשימה',
  twinkle: 'נצנוץ',
  wipe: 'מחיקה',
  fire: 'אש',
  strobe: 'סטרוב',
  comet: 'שביט',
  theater: 'אורות במה',
  pulse: 'פעימה',
  wave: 'גל',
  scanner: 'סורק',
  sparkle: 'ניצוצות',
  gradient: 'מעבר צבע',
  blink: 'הבהוב מלא',
  decay: 'דעיכה',
  bounce: 'קפיצה',
  ripple: 'אדוות',
  flicker: 'ריצוד',
  police: 'משטרה',
};

export const LED_CONTROLLER_HE: Record<PlanterLedController, string> = {
  none: 'ללא · צבע קבוע',
  ir: 'בקר בשלט אינפרא',
  wled: 'בקר WLED · שליטה מהטלפון',
};

/**
 * מיקום הפס — וזה לא פרט: הוא קובע את אורך הפס, את כיוון האור, ואת השאלה אם
 * אפשר יהיה להחליף אותו בלי לרוקן את האדנית.
 */
export const LED_POSITION_HE: Record<PlanterLedPosition, { name: string; note: string }> = {
  rim: {
    name: 'עליון · מתחת לצווארון',
    note: 'הפס נכנס לפרופיל מתחת לצווארון, פונה כלפי מטה. האור מלטף את הדופן מלמעלה, החריצים העליונים בוהקים והתחתונים דועכים — והכי חשוב, אפשר להגיע אליו מלמעלה בלי להוציא את התיבה ואת האדמה.',
  },
  wall: {
    name: 'על התיבה · מול החריצים',
    note: 'הפס מודבק לפאה החיצונית של התיבה הפנימית ומביט ישר אל החריצים. הכי חזק מבין השלושה, ואחיד לכל הגובה — אבל הוא יוצא יחד עם התיבה.',
  },
  foot: {
    name: 'תחתון · פונה למעלה',
    note: 'הפס עומד על רצפת האדנית ופונה כלפי מעלה. האור נשטף מלמטה ומעלה, והחריצים התחתונים הם החזקים. זו גם הנקודה שאליה המים מגיעים — צריך סרט אטום ומרווחים מעל חורי הניקוז.',
  },
};

/**
 * שמות האבנים בדיוק כפי שהם רשומים בקטלוג של DXF-STONE — סוג האבן, השם
 * המסחרי והגימור, בתקן ענף האבן. הצוות מזמין לפי הקוד, ST101 ומעלה.
 */
export const STONE_HE: Record<string, string> = {
  rock_face_03: 'אבן גיר — אנקר מחצבה — שבר טבעי',
  rock_face_04: 'גרניט — מצוק אפור — שבר תפר',
  rock_surface: 'אבן גיר — קונכיית מדבר — פני טבע',
  rock_boulder_cracked: 'גרניט — אפור שבור — בלוי ושחוק',
  rock_boulder_dry: 'אבן חול — ואדי יבש — טבעי ובלוי',
  rock_06: 'אבן גיר — מחצבה גס — שרוף',
  rock_08: 'צפחה — שכבות אפורות — שבר לרוחב',
  worn_rock_natural_01: 'אבן גיר — שנהב מיושן — בלוי ושחוק',
  seaside_rock: 'אבן גיר — אפור חופי — טבעי ובלוי',
  tiger_rock: 'קוורציט — פס טיגריס — פני טבע',
  dark_rock: 'בזלת — גולן שחור — שרוף ומוברש',
  dark_rock_02: 'בזלת — פחם וולקני — התזת חול',
  gray_rocks: 'גרניט — אפור פלדה — שרוף',
  quarry_wall: 'אבן גיר — חזית מחצבה — שבר טבעי',
  quarry_wall_02: 'אבן גיר — תפר מחצבה — נסור ושרוף',
  marble_rock_01: 'שיש — קררה גולמי — פני טבע',
  marble_rock_02: 'שיש — עורק כסף — שבר ומגולגל',
  marble_rock_03: 'שיש — גרפיט — התזת חול',
  marble_cliff_02: 'שיש — מצוק אלפיני — טבעי ובלוי',
  red_sandstone_wall: 'אבן חול — פטרה אדום — פני טבע',
  old_sandstone_02: 'אבן חול — אוכרה עתיקה — בלוי ושחוק',
  large_sandstone_blocks: 'אבן חול — גזית הורדוס — גזית',
  mossy_sandstone: 'אבן חול — ואדי טחוב — טבעי ובלוי',
  yellow_stone_wall: 'אבן גיר — ירושלמי זהב — טובזה',
  seaworn_sandstone_brick: 'אבן חול — כורכר — בלוי ושחוק',
  stone_wall_02: 'אבן שדה — שדה אפור — רגולרית',
  stone_wall_04: 'אבן שדה — תערובת כפרית — קיר שדה',
  rustic_stone_wall: 'אבן גיר — קרם כפרי — מלבני גס',
  stacked_stone_wall: 'צפחה — אפור ערוך — לדג׳סטון',
  castle_wall_slates: 'בלוסטון — מבצר — גזית',
  medieval_blocks_05: 'אבן גיר — צלבני — גזית',
  japanese_stone_wall: 'גרניט — קיוטו אפור — ערוך',
  lichen_rock: 'גרניט — חזזית אפורה — טבעי ובלוי',
  mossy_rock: 'אבן גיר — טחב מחצבה — טבעי ובלוי',
  rock_pitted_mossy: 'אבן גיר — טחב מחורר — בלוי ושחוק',
  concrete_layers: 'בטון — יצוק בתבנית — פני טבע',
  cracked_concrete: 'בטון — יצוק בלוי — בלוי ושחוק',
  rough_concrete: 'בטון — ברוטלי — התזת חול',
  slate_floor_02: 'צפחה — ולשי שחור — שסע טבעי',
  mixed_rock_tiles: 'קוורציט — תערובת פסיפס — פסיפס',
};

export const STONE_FAMILY_HE: Record<string, string> = {
  raw: 'סלע גולמי',
  dark: 'אבן כהה',
  marble: 'שיש',
  sandstone: 'אבן חול',
  wall: 'אבן בנייה',
  moss: 'אבן וצמחייה',
  concrete: 'בטון',
  slate: 'צפחה ואריח',
};

/**
 * השכבה האחרונה — היחידה שרואים את ההבדל ביניה מרוחק הגינה,
 * ובחוץ גם היחידה שעומדת בין הטייח לבין הגשם.
 */
export const STONE_SEAL_HE: Record<PlanterStoneSeal, { name: string; note: string }> = {
  matte: {
    name: 'אטים מט',
    note: 'האבן הכי אמיתית והכי פחות מוגנת. נושמת, ולוקחת כתם ממים קשים ומדשן.',
  },
  satin: {
    name: 'אטים משי',
    note: 'מדיח מים ודשן ועדיין נראה יבש. הבחירה הבטוחה לאדנית שמשקים אותה.',
  },
  wet: {
    name: 'אטים רטוב',
    note: 'סלע ספוג גשם, תמיד. זו החלטה עיצובית ולא סתם גימור — הצבעים עולים והשקעים מחשיכים.',
  },
};

export const FINISH_HE: Record<string, string> = {
  'silver-mirror': 'כסף מראה', 'gold-mirror': 'זהב מראה', 'silver-matte': 'כסף מט',
  'white-matte': 'לבן מט', 'black-matte': 'שחור מט', custom: 'צבע חופשי',
};

export const BACKDROP_HE: Record<string, string> = {
  'studio-dark': 'סטודיו כהה', 'studio-light': 'סטודיו בהיר', sky: 'חוץ',
};

// ---------------------------------------------------------------------------
// Direct UV print
// ---------------------------------------------------------------------------

export const PRINT_MODE_HE: Record<PlanterPrint, { name: string; note: string }> = {
  none: { name: 'בלי הדפסה', note: 'הלוח נשאר בגימור שהגיע בו מהספק.' },
  triangles: {
    name: 'מחולל משולשים',
    note: 'צבע מלא לכל פאה, מהפאות עצמן. הפאות הן בדיוק השטחים שלא מתקפלים, ולכן שם הדיו שורד.',
  },
  image: {
    name: 'תמונה מיובאת',
    note: 'PNG או JPG על פני הפריסה של הדופן. הפריסה היא סידור ההדפסה, אז מה שנוחת על פאה כאן הוא מה שעומד על הפאה הזו אחרי הקיפול.',
  },
};

export const PRINT_RULE_HE: Record<PlanterPrintRule, { name: string; note: string }> = {
  scatter: { name: 'פיזור', note: 'הגרלה לכל פאה. זכוכית מנופצת — וזה מה שרואים בקטלוג.' },
  ramp: { name: 'מדרג', note: 'הפלטה כמדרג מהרגל אל הפה. הגבול בין שני צבעים מזגזג בין הפאות ולא רץ כפס מסביב.' },
  around: { name: 'ספירלה', note: 'הפלטה מטיילת סביב האדנית ומטפסת חישוק־חישוק.' },
  facet: { name: 'אבן חן', note: 'פלטה אחת כאור וצל, לפי הכיוון שכל פאה פונה אליו. האדנית נקראת כגביש מלוטש.' },
  noise: { name: 'כתמים', note: 'רעש רך מעל הדופן — כתמים שחוצים כמה פאות, ולא פאה־פאה.' },
  harlequin: { name: 'ארלקין', note: 'שני המשולשים של כל מרובע לוקחים את שני קצות הפלטה. מעוינים.' },
};

export const PRINT_FIT_HE: Record<PlanterPrintFit, string> = {
  cover: 'מילוי (חיתוך בקצוות)', contain: 'התאמה (שוליים)', stretch: 'מתיחה',
};

/** The shelves, in the order the catalogue shows them. */
export const PRINT_PALETTE_HE: Record<string, string> = {
  carnival: 'קרנבל',
  harlequin: 'ארלקין',
  blueprint: 'שרטוט',
  desert: 'חול מדבר',
  jerusalem: 'אבן ירושלמית',
  mediterranean: 'ים תיכוני',
  olive: 'זית ואורן',
  citrus: 'פרדס',
  sunset: 'שקיעה',
  basalt: 'בזלת',
  mono: 'מונוכרום',
  bauhaus: 'באוהאוס',
  pastel: 'פסטל',
  neon: 'ניאון',
  copper: 'נחושת ופליז',
  [CUSTOM_PALETTE]: 'הצבעים שלי',
};

export const materialNameHe = (id: MaterialId) => MATERIAL_HE[id]?.name ?? getMaterial(id).name;
export const materialShortHe = (id: MaterialId) => MATERIAL_HE[id]?.short ?? getMaterial(id).shortName;

/** Sheet-piece names, matching the `finishPiece` labels the engine stamps. */
export function pieceLabelHe(id: string, label: string): string {
  if (id === 'wall') return 'דופן — מתקפלת למעלה';
  if (id === 'base') return 'לוח הבסיס';
  if (id === 'rim') return 'הצווארון העליון';
  if (id === 'liner-wall') return 'דופן התיבה הפנימית — מתקפלת למעלה';
  if (id === 'liner-base') return 'רצפת התיבה הפנימית';
  const band = /^band-(\d+)$/.exec(id);
  if (band) return `חישוק ${Number(band[1]) + 1}`;
  return label;
}

// ---------------------------------------------------------------------------
// Fabrication checks
// ---------------------------------------------------------------------------

// Re-derived from the engine rather than imported, because the engine keeps
// them private. They are two short formulas, and duplicating them is far
// cheaper than widening the engine's surface for a translation layer.
const flatten = (ring: Vec3[], sides: number): Vec2[] => ring.slice(0, sides).map((p) => ({ x: p.x, y: p.y }));

function inradius(points: Vec2[]): number {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  let smallest = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
    smallest = Math.min(smallest, Math.abs((b.x - a.x) * (a.y - cy) - (a.x - cx) * (b.y - a.y)) / length);
  }
  return smallest;
}

const fitsStock = (w: number, h: number, sw: number, sh: number) => (w <= sw && h <= sh) || (w <= sh && h <= sw);

/** Twice the signed area of a closed polygon, halved — the shoelace, as the engine does it. */
function area(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * The same check, said in Hebrew. Every number is recomputed here from the
 * model, so a check can never claim one dimension in English and another in
 * Hebrew.
 */
export function checkHe(check: FabricationCheck, model: PlanterModel, material: MaterialSpec): { title: string; detail: string } {
  const p = model.parameters;
  const short = materialShortHe(material.id);
  const minTab = Math.ceil(material.thickness * 4);

  switch (check.id) {
    case 'sheet-fit': {
      const over = model.pieces.find((piece) => !fitsStock(piece.width, piece.height, p.sheetWidth, p.sheetHeight));
      const name = over ? pieceLabelHe(over.id, over.label) : 'אחד החלקים';
      const size = over ? `${Math.ceil(over.width)} × ${Math.ceil(over.height)}` : '';
      return {
        title: 'חלק גדול מגיליון החומר',
        detail: `${name} דורש ${size} מ״מ, אבל הגיליון הוא רק ${p.sheetWidth} × ${p.sheetHeight} מ״מ. הקטן את האדנית, הורד חישוק, או עבור לבנייה בחישוקים — רצועות נפרדות קטנות בהרבה מפריסה אחת ארוכה.`,
      };
    }
    case 'sheet-count':
      return {
        title: `נדרשים ${model.sheets} גיליונות`,
        detail: `החלקים המקוננים תופסים ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} מ״מ — יותר ממה שגיליון אחד בגודל ${p.sheetWidth} × ${p.sheetHeight} מ״מ מכיל. תכנן ${model.sheets} גיליונות של ${short} להרצה הזו.`,
      };
    case 'bend-angle':
      return {
        title: 'קיפול חורג ממגבלת החומר',
        detail: `הקיפול התלול ביותר מסתובב ${model.maxBend.toFixed(0)}°, מעבר למגבלת ${material.maxBendAngle}° של ${short}. הציפוי ייסדק לאורך הקיפול.`,
      };
    case 'rim-width': {
      const mouth = inradius(flatten(model.vertices[p.rows], p.sides));
      return {
        title: 'הצווארון סוגר על פתח השתילה',
        detail: `צווארון ברוחב ${Math.round(p.rimWidth)} מ״מ משאיר פחות מ־15 מ״מ פתח על פה בקוטר ${Math.round(mouth * 2)} מ״מ. הצר את הצווארון או הרחב את הפתח.`,
      };
    }
    case 'development': {
      const bulged = Math.abs(p.bulge) > 0.5;
      const culprit = bulged
        ? 'דופן נפוחה היא דופן מעוקלת, ולכן אין פריסה שטוחה אחת שמתקפלת אליה. עבור לבנייה בחישוקים — כל חישוק נפרש במדויק והטבעות מסומררות זו לזו.'
        : p.footprint === 'rectangle' && getPlanterStyle(p.style).offsetStep > 0
          ? 'הסטת הטבעות במלבן מעבירה צלעות ארוכות אל קצרות, וזה מעקם את הדופן. רבע את המידות, בחר בסגנון פאה ישרה, או עבור לבנייה בחישוקים.'
          : p.rhythm > 1
            ? 'מקצב חישוקים הוא חינם על דופן ישרה ונאבק בחידוד. יישר את החידוד, הנמך את המקצב, או עבור לבנייה בחישוקים.'
            : 'הרפה מהחידוד או ממספר החישוקים, או עבור לבנייה בחישוקים.';
      return {
        title: 'הפאות לא יישבו שטוח בלי מתיחה',
        detail: `פרישת הדופן הזו כפריסה אחת משאירה ${model.developmentError.toFixed(1)} מ״מ של אי־התאמה בקצוות. ${culprit}`,
      };
    }
    case 'heat-bend':
      return {
        title: `אי אפשר לחרוץ ${short} בחריץ V`,
        detail: `אקריל מתנפץ בקיפול חד. כופף כל קיפול בחום מעל תבנית ברדיוס ${material.minRadius} מ״מ, והתייחס לפריסה כאל תכנית כיפוף ולא כמסלול חריצה.`,
      };
    case 'joint-tab':
      return {
        title: 'לשוניות הסימור קצרות לחומר הזה',
        detail: `לשונית של ${Math.round(p.jointTab)} מ״מ על חומר בעובי ${material.thickness} מ״מ כמעט לא משאירה מקום לנצור מסמרת הרחק מהקיפול. תן ללשוניות החיבור לפחות ${minTab} מ״מ.`,
      };
    case 'base-tab':
      return {
        title: 'לשוניות הבסיס קצרות לחומר הזה',
        detail: `לשונית של ${Math.round(p.baseTab)} מ״מ על חומר בעובי ${material.thickness} מ״מ כמעט לא משאירה מקום לנצור מסמרת הרחק מהקיפול. תן ללשוניות הבסיס לפחות ${minTab} מ״מ.`,
      };
    case 'rim-tab':
      return {
        title: 'לשוניות הצווארון קצרות לחומר הזה',
        detail: `לשונית של ${Math.round(p.rimTab)} מ״מ על חומר בעובי ${material.thickness} מ״מ כמעט לא משאירה מקום לנצור מסמרת הרחק מהקיפול. תן ללשוניות הצווארון לפחות ${minTab} מ״מ.`,
      };
    case 'facet-size': {
      const creases = model.pieces
        .filter((piece) => piece.id === 'wall' || piece.id.startsWith('band-'))
        .flatMap((piece) => piece.folds.map((f) => Math.hypot(f.x2 - f.x1, f.y2 - f.y1)));
      const shortest = creases.length > 0 ? Math.min(...creases) : 0;
      return {
        title: 'הפאות קטנות לחומר הזה',
        detail: `הקיפול הקצר ביותר הוא ${Math.round(shortest)} מ״מ מול תא מומלץ של ${material.recommendedCell} מ״מ ל־${short}. חריצים שנדחקים זה בזה נקרעים בנקודות המפגש.`,
      };
    }
    case 'stability': {
      const foot = inradius(flatten(model.vertices[0], p.sides)) * 2;
      return {
        title: 'גבוהה וצרה — הכבד את הבסיס',
        detail: `בסיס ברוחב ${Math.round(foot)} מ״מ מתחת לאדנית בגובה ${Math.round(p.height)} מ״מ מתהפך בקלות ברגע שהצמח נעשה כבד למעלה. הוסף משקולת ללוח הבסיס או הרחב את הבסיס.`,
      };
    }
    // --- stone -------------------------------------------------------------
    case 'stone-weight': {
      const coat = model.stone;
      if (!coat) return { title: check.title, detail: check.detail };
      const bare = model.pieces.reduce(
        (sum, piece) => sum + Math.abs(area(piece.outline))
          - piece.holes.reduce((cut, hole) => cut + Math.abs(area(hole)), 0), 0,
      ) * material.thickness * material.density;
      const heavy = coat.kg > bare * 1.5;
      return { title: `הציפוי מוסיף ${coat.kg.toFixed(1)} ק״ג לאדנית של ${bare.toFixed(1)} ק״ג`, detail: `${coat.coatMm.toFixed(0)} מ״מ של טיח על ${coat.areaM2.toFixed(2)} מ״ר הם ${coat.litres.toFixed(1)} ליטר, ומיובשים ${coat.kg.toFixed(1)} ק״ג שתלויים על קליפות ${short} ששוקלות ${bare.toFixed(1)} ק״ג בעצמן.${heavy ? ' ביחס הזה הלוח הוא חיפוי ולא מבנה — בנה דק יותר, או העמד את האדנית על בסיס ואל תרים אותה מהצווארון.' : ' שים לב לצווארון וללשוניות הבסיס כשמרימים אותה.'} כל מילימטר שיורד מהבנייה מוריד ${(coat.kg / coat.coatMm).toFixed(1)} ק״ג.` };
    }
    case 'stone-thick': {
      const coat = model.stone;
      if (!coat) return { title: check.title, detail: check.detail };
      return { title: `${coat.coatMm.toFixed(0)} מ״מ קרוב לתקרת העשרה מ״מ`, detail: `בנייה בעומק כזה דורשת ${coat.passes} מעברי טיח, והיא לא תיצמד לעצמה אם ממהרים אותם — ${coat.days} ימי עבודה לפני שהאטים מתקרב. היא גם בולטת ${coat.coatMm.toFixed(0)} מ״מ מכל קצה, כלומר גם הצווארון וגם הבסיס גדלים בכך. רוב מה שנקרא כסלע יושב בלאסור ולא בעובי.` };
    }
    case 'stone-crease': {
      const coat = model.stone;
      if (!coat) return { title: check.title, detail: check.detail };
      return { title: `השאר את הבנייה ${coat.keepOut.toFixed(0)} מ״מ מכל קיפול`, detail: `${coat.reliefRun.toFixed(2)} מ׳ של קיפולים עוברים מתחת לציפוי הזה. טיח שנמשך מעל קיפול הוא מה שסובל את המאמץ כשהאדנית נעה, והוא נסדק בדיוק לאורך הקיפול — הקו הכי נראה על החלק. העבר קו הפרדה ${coat.keepOut.toFixed(0)} מ״מ מכל צד, תן ללאסור להעביר את הצבע מעליו, והקיפול ייקרא כמו תפר בסלע ולא כמו שבר.` };
    }
    case 'stone-perf': {
      const coat = model.stone;
      if (!coat) return { title: check.title, detail: check.detail };
      const shut = coat.throat <= 0;
      return { title: shut ? 'הציפוי סוגר את החריצים' : `החריצים יורדים ל־${coat.throat.toFixed(0)} מ״מ`, detail: `הטיח נכנס גם על דופן כל חריץ ולא רק על הפנים, אז פתח של ${coat.opening.toFixed(0)} מ״מ מאבד ${(2 * coat.coatMm).toFixed(0)} מ״מ ומקבל ${coat.coatMm.toFixed(0)} מ״מ של עומק.${shut ? ' בעובי הזה הם נסגרים לגמרי — הדופן נפתחה לשווא.' : ''} או לבנות עד ${Math.max(0, (coat.opening * 0.45 - 0.5) / 2).toFixed(0)} מ״מ, או להגדיל קודם את החריצים. ועוד דבר: דופן מחוררת איטית לצביעה ממה שהשטח שלה אומר — כל פתח הוא קצה שצריך לעבוד סביבו.` };
    }
    case 'stone-led': {
      const coat = model.stone;
      if (!coat) return { title: check.title, detail: check.detail };
      return { title: 'הטיח מצר את אלומת האור', detail: `כל פתח הוא עכשיו חור של ${coat.throat.toFixed(0)} מ״מ בעומק ${coat.coatMm.toFixed(0)} מ״מ, ולא חור בקליפה של ${material.thickness} מ״מ. האור יוצא ממנו באלומה צרה יותר, אז הדופן נקראת כנקודות אור ולא כזוהר, ופחות ממנו מגיע לרצפה. בדרך כלל זה בדיוק מה שרוצים — אבל תכנן את הפס לפי זה, ושפשף את הטיח בזווית מבפנים אם רוצים פיזור.` };
    }
    case 'stone-seal':
      return {
        title: 'אטים מט על אדנית שמשקים',
        detail: 'מט הוא האבן הכי אמיתית והכי פחות מוגנת — הוא נושם, ולוקח כתם ממים קשים ומשאריות דשן. משי מדיח את שניהם ועדיין נראה יבש. רטוב נראה כמו סלע אחרי גשם, תמיד — וזו החלטה, לא גימור.',
      };
    // --- UV print ----------------------------------------------------------
    case 'print-stone': {
      const coat = model.stone;
      return {
        title: 'הטיח הולך על גבי ההדפסה',
        detail: `האדנית הזו מוגדרת גם מודפסת וגם מחופה ב־${coat?.code ?? 'אבן'}. ההדפסה נעשית על המכונה, שטוח, לפני הכיפוף; הטיח נמרח ביד אחרי זה, ${(coat?.coatMm ?? 0).toFixed(0)} מ״מ ממנו, על אותם משטחים בדיוק. שום דבר מהעיצוב המודפס לא שורד את זה. בחר אחד מהשניים — או הדפס את האדנית, ותן לצבע רק לכלוך דק במקום בנייה.`,
      };
    }
    case 'print-heat':
      return {
        title: `${short} מכופף בחום — הדפס אחרי`,
        detail: `אקריל לא נחרץ בחריץ V ולא מקופל קר: כל קיפול מכופף בחום על תבנית ברדיוס ${material.minRadius} מ״מ. דיו UV מוקשה שמגיע לחום כיפוף מצהיב, ובקיפול עצמו הוא מתקלף ונסדק. או שמדפיסים אחרי הכיפוף — כלומר מדפיסים חלק מעוצב ולא גיליון שטוח — או שגוזרים מלוח מרוכב, ששם הקיפול קר וסדר הפעולות הדפסה־ואז־כיפוף מחזיק.`,
      };
    case 'print-bed': {
      const job = model.print;
      return {
        title: `הקינון דורש ${job?.tiles ?? 2} מעברים על משטח ההדפסה`,
        detail: `החלקים מקוננים ל־${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} מ״מ ומשטח ההדפסה הוא ${job?.bed.width ?? 2500} × ${job?.bed.height ?? 1300} מ״מ, אז העיצוב מודפס באריחים. גבול בין אריחים הוא תפר נראה לעין והוא אף פעם לא ברישום מושלם. קנן מחדש כך שהתפר ייפול בין חלקים ולא על חלק, או הקטן את האדנית לגיליון שהמשטח בולע בשלמותו.`,
      };
    }
    case 'print-grout': {
      const job = model.print;
      return {
        title: 'הדיו עובר ישר מעל הקיפולים',
        detail: `בלי פוגה העיצוב רץ על פני ${(job?.groutRun ?? 0).toFixed(2)} מ׳ של קיפול שעומד להתקפל. שכבת UV מוקשה היא נוקשה — היא נסדקת לאורך הקיפול, והקיפול הוא הקו הכי נראה לעין על האדנית. תן לדיו להיעצר ${DEFAULT_GROUT} מ״מ לפניו, והקו החשוף נקרא כפוגה בין אריחים ולא כסדק לרוחבם.`,
      };
    }
    case 'print-dropped': {
      const job = model.print;
      const count = job?.dropped ?? 0;
      return {
        title: `${count} ${count === 1 ? 'פאה קטנה מדי' : 'פאות קטנות מדי'} להדפסה`,
        detail: `עם ${(job?.grout ?? 0).toFixed(1)} מ״מ פוגה משלושת הצדדים, ל־${count} ${count === 1 ? 'פאה' : 'פאות'} לא נשאר כלום באמצע, והן נשארות חשופות במקום להידפס כרסיס שהראש רק ישפריץ ממנו לתוך החריץ. פחות פאות וגדולות יותר — או פחות פוגה.`,
      };
    }
    case 'print-image':
      return {
        title: 'הדפסת תמונה בלי תמונה',
        detail: 'האדנית מוגדרת להדפסה של קובץ מיובא ולא נטען אף קובץ, אז קובץ ההדפסה יוצא ריק. טען PNG או JPG, או חזור למחולל הפאות.',
      };
    case 'print-white':
      return {
        title: 'בלי בסיס לבן',
        detail: 'דיו CMYK הוא שקוף. מודפס ישירות על אלומיניום טבעי או על מראה הוא נקרא כגוון על מתכת ולא כצבע שאושר, והוא משתנה לפי הזווית שעומדים בה. זה אפקט לגיטימי לגמרי וזה חוסך חצי מהדיו — אבל זו לא הפלטה שרואים על המסך.',
      };
    case 'print-perf': {
      const job = model.print;
      const cuts = model.perfCells.reduce(
        (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
      );
      return {
        title: 'העיצוב מודפס מסביב לחריצים',
        detail: `${cuts} פתחים ממוסכים מחוץ לעיצוב — אין מתחתם לוח שיקלוט דיו. גם קצוות החיתוך עצמם נשארים חשופים ל־${(job?.grout ?? 0).toFixed(1)} מ״מ, אז לכל פתח יש מסגרת דקה לא מודפסת. באדנית מוארת המסגרת הזו היא מה שהאור מלטף, והיא נקראת כקו מתאר זוהר אחרי החשכה.`,
      };
    }
    // --- lighting ----------------------------------------------------------
    case 'perf-liner':
      return {
        title: 'דופן פתוחה בלי שום דבר מאחוריה',
        detail: 'חריצים בדופן בלי תיבה פנימית פירושם אדמה שנוגעת בפתחים: היא נשטפת החוצה מכל אחד מהם בהשקיה הראשונה, והמים זורמים על הצד הפנימי של הציפוי אל מה שמחווט שם. הרכב את התיבה הפנימית, או השאר את הדופן אטומה.',
      };
    case 'perf-empty': {
      const reason = p.perfSkirt > p.height * 0.95
        ? `שוליים אטומים של ${Math.round(p.perfSkirt)} מ״מ על אדנית בגובה ${Math.round(p.height)} מ״מ לא משאירים דופן מעליהם`
        : `שוליים של ${Math.round(p.perfMargin)} מ״מ ורווח של ${Math.round(p.perfWeb)} מ״מ גומרים כל פאה במידה הזו`;
      return {
        title: 'שום דבר לא נחתך',
        detail: `הדופן מוגדרת לחריצה, אבל ${reason}. הורד את השוליים האטומים, הצר את השוליים או את הרווח, או הקטן את עדינות התבנית.`,
      };
    }
    case 'perf-tool':
      return {
        title: `${model.perfDropped} חריצים נשארו אטומים`,
        detail: `כרסם ${p.perfTool} מ״מ לא יכול להיכנס לתאים כל כך קטנים, ולכן הם נשארו מלאים במקום להיחתך כקו שהכלי יצטרך לגרד סביבו. הקטן את עדינות התבנית או את הרווח כדי ליישר את התבנית, או השתמש בכרסם קטן יותר.`,
      };
    case 'perf-web':
      return {
        title: 'הרווחים בין החריצים דקים לחומר הזה',
        detail: `רווח של ${Math.round(p.perfWeb)} מ״מ בין חריצים ב־${short} בעובי ${material.thickness} מ״מ מתעקם ממשקלו שלו ונקרע בפינות. תן לרווח לפחות ${Math.ceil(material.thickness * 3)} מ״מ.`,
      };
    case 'perf-margin':
      return {
        title: 'החריצים נדחקים אל קווי הקיפול',
        detail: `שוליים של ${Math.round(p.perfMargin)} מ״מ משאירים מעט מאוד חומר מלא לצד קיפול ב־${short} בעובי ${material.thickness} מ״מ. חריץ V שעובר כל כך קרוב לחור נקרע לתוכו כשהקיפול נסגר. תן לשוליים לפחות ${Math.ceil(material.thickness * 5)} מ״מ.`,
      };
    case 'perf-open':
      return p.perforation === 'foldout'
        ? {
          title: model.perfOpenArea > 0.57 ? 'יותר מדי מהדופן פתוח' : 'הדופן מאבדת יותר מקישוט',
          detail: `${Math.round(model.perfOpenArea * 100)}% מהדופן נפתחים. שום דבר לא יוצא מהלוח — כל עלה נשאר מחובר — אבל שתיים משלוש צלעותיו חתוכות, ומעבר לכשליש מהשטח הפאות מתרפות בין הקיפולים בכל זאת. הקטן את גודל החריץ.`,
        }
        : {
          title: model.perfOpenArea > 0.3 ? 'יוצא יותר מדי חומר מהדופן' : 'הדופן מאבדת יותר מקישוט',
          detail: `${Math.round(model.perfOpenArea * 100)}% מהדופן חתוכים. ${short} נושא את העומס בשתי שכבות אלומיניום דקות, ומעבר לכשישית מהשטח הפאות מתרפות בין הקיפולים. הקטן את גודל החריץ — הוא הידית שקובעת כמה חומר יוצא מהלוח, בעוד שעדינות התבנית קובעת רק לכמה חלקים הוא מתחלק.`,
        };
    case 'liner-fit':
      return {
        title: 'אין מקום לתיבה הפנימית',
        detail: `חלל תאורה של ${Math.round(p.cavity)} מ״מ מסביב לא משאיר בתוך האדנית הזו שום דבר לבנות ממנו תיבה. הצר את החלל או הרחב את האדנית.`,
      };
    case 'liner-cavity':
      return {
        title: 'חלל התאורה צר לפס לד',
        detail: `רווח של ${Math.round(p.cavity)} מ״מ צריך להכיל את הפס, את הפרופיל שלו ואת החיווט מאחוריו. תכנן 14 מ״מ, או הדבק סרט חשוף ישר לציפוי — ודע שלא יהיה אפשר להחליף אותו.`,
      };
    case 'solar-fit': {
      const rim = model.pieces.find((piece) => piece.id === 'rim');
      const mouthBand = Math.min(p.rimWidth, Math.max(0, inradius(flatten(model.vertices[p.rows], p.sides)) - 15));
      const edge = rim
        ? Math.max(...rim.outline.map((point, i, all) => {
          const next = all[(i + 1) % all.length];
          return Math.hypot(next.x - point.x, next.y - point.y);
        }))
        : 0;
      // The panel's own body has to land on the collar, not just its window —
      // 8 mm of material at each side of it, matching the engine's SOLAR_EDGE.
      return p.solarLength + 16 > mouthBand
        ? {
          title: 'הפאנל לא נכנס לצווארון',
          detail: `פאנל באורך ${Math.round(p.solarLength)} מ״מ צריך צווארון ברוחב ${Math.ceil(p.solarLength + 16)} מ״מ לפחות כדי להידבק עליו, וכאן הוא ${Math.round(mouthBand)} מ״מ${p.rimWidth > mouthBand + 0.5 ? ` — פתח השתילה כבר קיצץ אותו מ־${Math.round(p.rimWidth)} מ״מ שביקשת` : ''}. לא נחתך חלון. הרחב את הצווארון, או בחר פאנל קצר יותר.`,
        }
        : {
          title: 'הפאנל לא נכנס לצווארון',
          detail: `פאנל ברוחב ${Math.round(p.solarWidth)} מ״מ צריך צלע צווארון באורך ${Math.ceil(p.solarWidth + 16)} מ״מ לפחות, והארוכה ביותר כאן היא ${Math.round(edge)} מ״מ. לא נחתך חלון. הרחב את האדנית, הוסף צלעות, או בחר פאנל צר יותר.`,
        };
    }
    // --- the electrical side ------------------------------------------------
    case 'led-liner':
      return {
        title: 'לפס הלד אין על מה להידבק',
        detail: 'בלי תיבה פנימית הפס נדבק לצד הפנימי של הדופן, מתחת לאדמה — רטוב כל העונה, ואי אפשר להגיע אליו בלי לרוקן את האדנית. הרכב את התיבה: מקומו של הפס הוא על הפאה החיצונית שלה, יבש, מול החריצים.',
      };
    case 'led-dark':
      return {
        title: 'לאור אין דרך לצאת',
        detail: `פס ${ledNameHe(p.led)} בתוך דופן אטומה מאיר את החלל ותו לא. חרוץ את הדופן — כל אחת מהתבניות תעשה את זה — או אל תתקין פס.`,
      };
    case 'led-feed': {
      const light = model.lighting;
      if (!light) return { title: check.title, detail: check.detail };
      return {
        title: `הזן את הפס ב־${light.feeds} נקודות`,
        detail: `${(light.length / 1000).toFixed(2)} מ׳ של פס ${light.volts} וולט שמושך ${light.amps.toFixed(2)} אמפר מאבד מתח על הנחושת של עצמו: הקצה הרחוק יוצא חלש יותר, ובלבנים גם חם יותר בגוון מהקצה הקרוב. הובל את ההזנה ל־${light.feeds} נקודות מפוזרות סביב החלל — אותו זוג חוטים, מחובר בכל אחת.${light.addressable ? ' הדאטה עדיין נכנס פעם אחת, בנורה הראשונה.' : ''}`,
      };
    }
    case 'led-data': {
      const light = model.lighting;
      if (!light) return { title: check.title, detail: check.detail };
      return {
        title: 'מוען דורש בקר ו־5 וולט נקיים',
        detail: `${light.leds} פיקסלים של WS2812 בהספק מלא הם ${light.peakWatts.toFixed(1)} וואט — ${light.amps.toFixed(1)} אמפר ב־5 וולט, וזה זרם אמיתי בחוט דק. תכנן ספק 5 וולט ${light.supply} וואט, נגד 330 אוהם בקו הדאטה וקבל 1000 מיקרופאראד על הפיקסל הראשון, והשאר את ההפעלה על ${Math.round(p.ledBrightness)}% כמו בשרטוט: המספרים האלה נמדדים בלבן מלא, ואנימציה כמעט אף פעם לא מבקשת אותו.`,
      };
    }
    case 'led-controller':
      return {
        title: 'אין מי שיריץ את המצב',
        detail: `„${LED_EFFECT_HE[p.ledEffect]}" דורש משהו שפונה לכל פיקסל בנפרד, ולא הוגדר בקר — בלעדיו אפשר להחזיק את הפס בצבע אחד בלבד, וזו דרך יקרה לקנות פס לבן. בחר בקר WLED בשביל המצבים האלה מהטלפון, או בקר אינפרא בשביל המצבים שצרובים בו.`,
      };
    case 'led-wet':
      return {
        title: 'הפס נמצא בדיוק במקום שהמים מגיעים אליו',
        detail: 'פס שעומד על לוח הבסיס יושב בנקודה הנמוכה של אדנית שמשקים אותה ושמנוקבת לניקוז. בחר סרט IP65, אטום את החיבורים ואת נקודת ההזנה בסיליקון, והעמד אותו על מרווחים מעל חורי הניקוז — או העלה אותו מתחת לצווארון, שם הוא נשאר יבש ועדיין נגיש.',
      };
    case 'led-mains': {
      const light = model.lighting;
      if (!light) return { title: check.title, detail: check.detail };
      return {
        title: 'אין פאנל — האדנית הזו מוזנת מבחוץ',
        detail: `הפס מבקש ${light.demand.toFixed(1)} ואט־שעה בלילה, ב־${Math.round(p.ledBrightness)}% למשך ${Math.round(p.ledHours)} שעות. בלי פאנל בצווארון זה מגיע משנאי ${light.supply} וואט על כבל, או מסוללה שנטענת בבית — בערך ${light.cells} תאי 18650 ללילה.`,
      };
    }
    case 'led-solar': {
      const light = model.lighting;
      if (!light) return { title: check.title, detail: check.detail };
      const grow = Math.sqrt(light.demand / light.harvest);
      return {
        title: `הפאנל מחזיק ${light.runtime.toFixed(1)} שעות, לא ${Math.round(p.ledHours)}`,
        detail: `פאנל ${Math.round(p.solarWidth)} × ${Math.round(p.solarLength)} מ״מ מכניס בערך ${light.harvest.toFixed(1)} ואט־שעה ביום ממוצע, ו־${light.watts.toFixed(1)} וואט גומרים את זה ב־${light.runtime.toFixed(1)} שעות. בשביל ${Math.round(p.ledHours)} שעות התקן פאנל של בערך ${Math.ceil(p.solarWidth * grow)} × ${Math.ceil(p.solarLength * grow)} מ״מ, או הנמך את ההפעלה ל־${Math.max(5, Math.floor(p.ledBrightness * light.runtime / p.ledHours))}% במקום ${Math.round(p.ledBrightness)}%.`,
      };
    }
    case 'ready': {
      const how = p.construction === 'banded'
        ? `${p.rows} ${p.rows === 1 ? 'חישוק מסומרר' : 'חישוקים מסומררים'}`
        : `${p.rows} ${p.rows === 1 ? 'חישוק' : 'חישוקים'} מפריסה אחת`;
      const cutOuts = model.perfCells.reduce(
        (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
      );
      const lit = [
        cutOuts > 0 ? `${cutOuts} ${p.perforation === 'foldout' ? 'עלים מקופלים' : 'חריצים'}` : '',
        model.liner ? `תיבה פנימית בגובה ${Math.round(model.liner.height)} מ״מ על חלל ${Math.round(p.cavity)} מ״מ` : '',
        p.solar ? 'חלון לפאנל בצווארון' : '',
        model.lighting ? `${(model.lighting.length / 1000).toFixed(2)} מ׳ ${ledNameHe(model.lighting.led)} ב־${model.lighting.watts.toFixed(1)} וואט` : '',
      ].filter(Boolean);
      return {
        title: 'מאושר לייצור',
        detail: `${p.sides} צדדים × ${how} על ${short}, קיפול תלול ביותר ${model.maxBend.toFixed(0)}°, מקונן ל־${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} מ״מ.${lit.length > 0 ? ` בנייה מוארת: ${lit.join(', ')}.` : ''}`,
      };
    }
    default:
      return { title: check.title, detail: check.detail };
  }
}

/** Every check in the list, rewritten in Hebrew. */
export const checksHe = (checks: FabricationCheck[], model: PlanterModel, material: MaterialSpec): FabricationCheck[] =>
  checks.map((check) => ({ ...check, ...checkHe(check, model, material) }));

/** Engine stats carry their units inside the string; these are the mm/m/L swaps. */
export const unitsHe = (value: string) => value
  .replace(/(\d+)\/m · /, '$1 לד/מ׳ · ')
  .replace(/ · (\d+) LEDs/, ' · $1 נורות')
  .replace(/ A at (\d+) V · (\d+) W driver/, ' אמפר ב־$1 וולט · שנאי $2 וואט')
  .replace(/ Wh\/day · runs ([\d.]+) h/, ' ואט־שעה ליום · מספיק ל־$1 שעות')
  .replace(/([\d.]+) W\b/, '$1 וואט')
  .replace(/(\d+)% open · (\d+) folded petals · nothing removed/, '$1% מהדופן פתוח · $2 עלים מקופלים · בלי הסרת חומר')
  .replace(/(\d+)% open · (\d+) cut-outs/, '$1% מהדופן פתוח · $2 חריצים')
  .replace(/ across (\d+) sheets/, ' על פני $1 גיליונות')
  .replace(/ mm/g, ' מ״מ')
  .replace(/ m\b/g, ' מ׳')
  .replace(/ L\b/g, ' ליטר')
  .replace(/ kg\b/g, ' ק״ג');

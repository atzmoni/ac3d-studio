'use client';

/**
 * The DXF.TLV storefront — the Plants Webflow template's architecture, rebuilt
 * in Hebrew around what this shop actually sells.
 *
 * The template's skeleton is kept beat for beat: utility strip, white nav,
 * split hero with the oversized display type and the curved white bite out of
 * the sage field, shop grid, tinted featured band, two-column categories,
 * six-cell feature grid, testimonials, blog, Instagram row, newsletter and the
 * link-column footer. What changes is the palette — the original's muted sage
 * is pushed towards leaf and lime so the page reads bright and alive — and the
 * direction, which is RTL throughout.
 *
 * The one section the template has no counterpart for is the studio itself.
 * It sits in the middle of the page rather than at the end, because editing a
 * planter online is the product; everything above it exists to get the visitor
 * there, and everything below it answers what happens after.
 */

import {
  ArrowDown, ArrowLeft, FileCode2, Headphones, Instagram, Leaf, Mail, Menu, Palette,
  PencilRuler, Phone, Quote, Ruler, Scissors, Search, ShieldCheck, ShoppingBag, Sparkles,
  Triangle, Truck, X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import MediaSlot from '@/components/garden/MediaSlot';
import { media, mediaFocus, mediaPoster } from '@/components/garden/media';
import type { StudioStatus } from '@/components/garden/PlanterStudioHe';
import { DEFAULT_PLANTER } from '@/lib/planter-engine';
import { PRESET_HE } from '@/lib/planter-i18n-he';
import { PLANTER_PRESETS } from '@/lib/planter-styles';

// Spaced for reading, unspaced for the tel: link — a dialler wants digits.
const PHONE = '055-993-3905';
const PHONE_TEL = '0559933905';
const EMAIL = 'atzmon1983@gmail.com';

/**
 * The studio is a WebGL canvas over geometry the server and the browser each
 * compute in floating point, so rendering it twice only produces a hydration
 * argument over the last digit of an SVG coordinate. It is also useless until
 * it is interactive. So it mounts in the browser alone, and the marketing copy
 * around it — the part worth indexing — still renders on the server.
 */
const PlanterStudioHe = dynamic(() => import('@/components/garden/PlanterStudioHe'), {
  ssr: false,
  loading: () => (
    <div className="g-studio-loading">
      <Leaf size={22} aria-hidden="true" />
      <span>טוען את הסטודיו…</span>
    </div>
  ),
});

// ---------------------------------------------------------------------------
// Catalogue rows, built from the same presets the studio loads
// ---------------------------------------------------------------------------

interface CatalogueItem {
  id: string;
  name: string;
  note: string;
  category: string;
  size: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  box: 'תיבה', faceted: 'מפואטת', banded: 'חישוקים', column: 'עמוד',
};

/** A card's headline size, read off the preset's own parameters — never typed twice. */
function catalogueItem(id: string): CatalogueItem {
  const preset = PLANTER_PRESETS.find((item) => item.id === id);
  if (!preset) return { id, name: id, note: '', category: '', size: '' };
  const p = { ...DEFAULT_PLANTER, ...preset.parameters };
  const he = PRESET_HE[preset.id];
  const width = p.footprint === 'rectangle'
    ? `${Math.round(p.topWidth)} × ${Math.round(p.topLength)}`
    : `⌀ ${Math.round(p.topDiameter)}`;
  return {
    id: preset.id,
    name: he?.name ?? preset.name,
    note: he?.note ?? preset.note,
    category: CATEGORY_LABEL[preset.category] ?? preset.category,
    size: `${width} × ${Math.round(p.height)} מ״מ`,
  };
}

const SHOP_IDS = [
  'hex-diamond-500', 'box-smooth-500', 'hex-crystal-500', 'octa-column',
  'hex-barrel', 'box-trough', 'hex-twist', 'hex-low-bowl',
];
const FEATURED_IDS = ['hex-diamond-500', 'hex-crystal-tall', 'box-crystal'];
/** The four finishes the range photograph is shot in. */
const RANGE_COLOURS = [
  { name: 'כחול', hex: '#4a7ab0' },
  { name: 'ירוק', hex: '#3f9145' },
  { name: 'צהוב', hex: '#e0ac33' },
  { name: 'אדום', hex: '#cf3b32' },
];

const CATEGORY_COLUMNS = [
  { title: 'מפואטות', ids: ['hex-crystal-500', 'penta-crystal', 'tri-facet'] },
  { title: 'חישוקים', ids: ['hex-barrel', 'hex-waisted', 'octa-barrel'] },
];

const NAV_LINKS = [
  { href: '#top', label: 'בית' },
  { href: '#studio', label: 'הסטודיו' },
  { href: '#shop', label: 'קטלוג' },
  { href: '#process', label: 'התהליך' },
  { href: '#audience', label: 'למי זה' },
  { href: '#blog', label: 'בלוג' },
  { href: '#contact', label: 'צור קשר' },
];

/** The four things the shop drawing promises — straight off the spec sheet. */
const SPECS = [
  { icon: Triangle, title: 'מוכן לחיתוך V', text: 'מותאם לביצוע חיתוך V נקי' },
  { icon: Scissors, title: 'CNC ROUTER / 3-AXIS', text: 'תואם לכלל מכונות ה־CNC הסטנדרטיות' },
  { icon: Ruler, title: 'V-BIT: 90° – 120°', text: 'טווחי זווית מומלצים לביטים' },
  { icon: Sparkles, title: 'עיצוב מיקשה אחת', text: 'חיתוך וקיפול מלוח שטוח יחיד' },
];

const PROCESS = [
  {
    icon: Ruler, step: '01', title: 'לוח אלובונד',
    text: 'גיליון ACM / ALUCOBOND שטוח, 3 או 4 מ״מ. קשיח, עמיד בחוץ, וקל מספיק כדי להרים אדנית בגובה מטר בזוג ידיים.',
  },
  {
    icon: Scissors, step: '02', title: 'כרסום וחיתוך V',
    text: 'הכרסם חותך את המתאר וחורץ את קווי הקיפול בחריץ V מהצד האחורי. קובץ אחד, קווים מאוחדים, מסלול רצוף.',
  },
  {
    icon: Leaf, step: '03', title: 'אדנית',
    text: 'מקפלים על החריצים, מסמררים את התפר, מרכיבים בסיס וצווארון — גוף אחד נקי, בלי ריתוך.',
  },
];

const AUDIENCE = [
  {
    icon: PencilRuler, title: 'מעצבי פנים',
    text: 'מידה מדויקת לפרויקט, קובץ 1:1 לספק, וגוון RAL שמתאים לפלטה של החלל — בלי לחכות לדגם מהמחסן.',
  },
  {
    icon: Palette, title: 'אמנים',
    text: 'גאומטריה חדשה לגמרי: פיתול, מקצב חישוקים, כוכב. אם הפריסה נפרשת שטוח — היא ניתנת לייצור.',
  },
  {
    icon: Sparkles, title: 'בעלי מלאכה',
    text: 'קובץ SVG ו־DXF עם שכבות CUT / MOUNTAIN / VALLEY נפרדות, מוכן לכרסם שלכם או לכרסם שלנו.',
  },
  {
    icon: ShoppingBag, title: 'לקוחות פרטיים',
    text: 'אפשר להזמין גם אדנית אחת, למרפסת או לסלון. מעצבים כאן אונליין ומקבלים אותה מוכנה להרכבה.',
  },
];

const FEATURES = [
  { icon: ShieldCheck, title: 'ייצור מדויק', text: 'כל קובץ יוצא בקנה מידה 1:1 עם בדיקת ייצור שרצה על הגאומטריה לפני שהוא יורד לכרסם.' },
  { icon: Leaf, title: 'עמידות בחוץ', text: 'אלובונד לא מחליד ולא מתעוות בשמש. אותה אדנית עובדת במרפסת, בלובי ובחצר.' },
  { icon: Palette, title: 'צבע חי', text: 'מראה זהב, מראה כסף, מט או כל גוון RAL — הגימור נבחר בנפרד מחומר הייצור.' },
  { icon: FileCode2, title: 'גם כקובץ דיגיטלי', text: 'אפשר להזמין את הקובץ בלבד — DXF ו־SVG מוכנים לכרסם, בלי לחכות למשלוח.' },
  { icon: Truck, title: 'משלוח שטוח', text: 'האדנית נשלחת פרוסה ומתקפלת במקום, כך שגם גוף גדול נכנס בדלת ובמעלית.' },
  { icon: Headphones, title: 'ליווי לאורך הדרך', text: `שאלה על מידה, חומר או הרכבה? מדברים איתנו ${PHONE}.` },
];

/**
 * Sample copy, and labelled as such on the page itself.
 *
 * Nobody said these things. They are here so the section can be judged at its
 * real length — six quotes of roughly the right weight change how the page
 * scrolls, and empty bars do not. Every card carries a "לדוגמה" badge, and the
 * whole lot gets replaced the day there are real ones.
 */
const TESTIMONIALS = [
  { name: 'לקוחה לדוגמה', role: 'מעצבת פנים', text: 'הגדרתי את המידה המדויקת שהפרויקט דרש, ירדתי עם הקובץ לספק, והאדנית הגיעה בדיוק לנישה. לא חיכיתי לקטלוג.' },
  { name: 'לקוח לדוגמה', role: 'אמן', text: 'פיתלתי את הגאומטריה עד שהיא נראתה נכון, והבדיקה אמרה לי שהיא עדיין נפרשת שטוח. זה כל מה שהייתי צריך לדעת.' },
  { name: 'לקוח לדוגמה', role: 'בעל מלאכה', text: 'ה־DXF הגיע עם שכבות נפרדות לחיתוך ולחריצה. נכנס לכרסם שלי כמו שהוא, בלי לסדר קווים ביד.' },
  { name: 'לקוחה לדוגמה', role: 'לקוחה פרטית', text: 'הזמנתי אדנית אחת למרפסת. עיצבתי אותה בדפדפן בערב, וקיבלתי אותה שטוחה עם הוראות קיפול.' },
  { name: 'לקוח לדוגמה', role: 'אדריכל נוף', text: 'שנתיים בחוץ, שמש מלאה, בלי חלודה ובלי עיוות. זה מה שהפך את האלובונד לברירת המחדל שלי.' },
  { name: 'לקוחה לדוגמה', role: 'סטודיו לעיצוב', text: 'הגוף הגדול נכנס במעלית שטוח והורכב בדירה. זה פתר לנו בעיה שלא ידענו שתהיה.' },
];

const POSTS = [
  { tag: 'מדריך', title: 'איך בוחרים עובי אלובונד לאדנית חוץ', media: 'צילום: גיליון אלובונד על שולחן הכרסם' },
  { tag: 'סטודיו', title: 'מה זה בעצם פריסה שנפרשת שטוח', media: 'צילום: פריסה שטוחה עם קווי חריץ V' },
  { tag: 'טיפוח', title: 'ניקוז ושתילה באדנית מתכת', media: 'צילום: שתילה בתוך אדנית מוגמרת' },
];

const FOOTER_COLUMNS = [
  { title: 'החנות', links: ['קטלוג אדניות', 'אדניות תיבה', 'אדניות מפואטות', 'עמודי כניסה', 'אדניות בחישוקים'] },
  { title: 'הסטודיו', links: ['עריכה אונליין', 'גאומטריה חדשה', 'ייצוא SVG ו־DXF', 'בדיקת ייצור', 'מדריך הרכבה'] },
  { title: 'העסק', links: ['עלינו', 'לוחות ACM / אלובונד', 'שאלות נפוצות', 'תנאי שימוש', 'צור קשר'] },
];

// ---------------------------------------------------------------------------

function Brand() {
  return (
    <>
      <span className="g-brand-mark"><Leaf size={16} aria-hidden="true" /></span>
      <span className="g-brand-text">
        <strong>DXF<i>.</i>TLV</strong>
        <small>דיוק גיאומטרי בצבע חי</small>
      </span>
    </>
  );
}

export default function GardenSite() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<StudioStatus>({ blocking: false, readout: [] });

  // The nav sits over the sage hero at the top and over white further down, so
  // it only earns its shadow once the page has actually scrolled.
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const jump = useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!href.startsWith('#')) return;
    event.preventDefault();
    setMenuOpen(false);
    const target = href === '#top' ? document.body : document.querySelector(href);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="garden" dir="rtl" lang="he" id="top">
      {/* --- utility strip ------------------------------------------------- */}
      <div className="g-topstrip">
        <span><Leaf size={13} aria-hidden="true" /> מיוצר בישראל מלוחות ACM / ALUCOBOND</span>
        <span className="g-strip-dot" aria-hidden="true" />
        <span>עיצוב אונליין · ייצוא לכרסם · משלוח לכל הארץ</span>
        <span className="g-strip-dot" aria-hidden="true" />
        <a href={`tel:${PHONE_TEL}`}><Phone size={13} aria-hidden="true" /> {PHONE}</a>
        <span className="g-strip-dot" aria-hidden="true" />
        <a href={`mailto:${EMAIL}`}><Mail size={13} aria-hidden="true" /> {EMAIL}</a>
      </div>

      {/* --- navigation ---------------------------------------------------- */}
      <header className={`g-nav ${lifted ? 'lifted' : ''}`}>
        <div className="g-wrap g-nav-inner">
          <a className="g-brand" href="#top" onClick={(event) => jump(event, '#top')}><Brand /></a>

          <nav className={`g-nav-links ${menuOpen ? 'open' : ''}`} aria-label="ניווט ראשי">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={(event) => jump(event, link.href)}>{link.label}</a>
            ))}
          </nav>

          <div className="g-nav-actions">
            <button className="g-icon-btn" aria-label="חיפוש"><Search size={18} aria-hidden="true" /></button>
            <button className="g-icon-btn" aria-label="סל ההזמנות">
              <ShoppingBag size={18} aria-hidden="true" />
              <i className="g-cart-count">0</i>
            </button>
            <button
              className="g-icon-btn g-burger"
              aria-label={menuOpen ? 'סגירת התפריט' : 'פתיחת התפריט'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {/* --- hero ---------------------------------------------------------- */}
      <section className="g-hero">
        <div className="g-hero-media">
          <MediaSlot
            src={media('hero')}
            poster={mediaPoster('hero')}
            focus={mediaFocus('hero')}
            label="סרטון פתיח: סקיצה של אדנית על מפית, עם הפריסה השטוחה משורטטת מתחתיה, הופכת לאדנית מקופלת שנצבעת ביד על שולחן העבודה"
            ratio="4 / 5"
            shape="square"
            className="g-hero-photo"
            priority
          />
        </div>

        <div className="g-hero-copy">
          <div className="g-hero-type">
            <span className="g-hero-kicker">סטודיו לעיצוב</span>
            <h1 className="g-hero-1">אדניות</h1>
            <h1 className="g-hero-2">גאומטריות.</h1>
          </div>

          <div className="g-hero-lede">
            <h2>מלוח אלובונד שטוח לאדנית — אונליין</h2>
            <p>
              מעצבים אדנית בדפדפן, רואים אותה מתקפלת בתלת־ממד, ומורידים קובץ כרסום מדויק בקנה מידה 1:1.
              כל אדנית נחתכת מלוח ACM אחד, נחרצת בחיתוך V ומתקפלת לגוף מיקשה אחת.
            </p>
            <div className="g-hero-actions">
              <Link className="g-btn" href="/planter/studio">
                פתחו את הסטודיו <ArrowLeft size={16} aria-hidden="true" />
              </Link>
              <a className="g-btn g-btn-ghost" href="#shop" onClick={(event) => jump(event, '#shop')}>לקטלוג</a>
            </div>
          </div>
        </div>

        {/* The template bites a curved white corner out of the sage field and
            parks the call-us lockup inside it. */}
        <div className="g-hero-curve">
          <div className="g-curve-lockup">
            <MediaSlot src={media('contact')} label="דיוקן: איש הקשר בסטודיו" ratio="1 / 1" shape="round" className="g-curve-avatar" quiet />
            <a href={`tel:${PHONE_TEL}`}>דברו איתנו · {PHONE}</a>
          </div>
          <span className="g-curve-fill" aria-hidden="true" />
        </div>

        <a className="g-scroll-down" href="#process" onClick={(event) => jump(event, '#process')} aria-label="גלול לתהליך">
          <ArrowDown size={16} aria-hidden="true" />
        </a>
      </section>

      {/* --- spec strip ---------------------------------------------------- */}
      <section className="g-specs" aria-label="מפרט ייצור">
        <div className="g-wrap g-spec-row">
          {SPECS.map((spec) => (
            <div className="g-spec" key={spec.title}>
              <span className="g-spec-icon"><spec.icon size={17} aria-hidden="true" /></span>
              <div>
                <strong>{spec.title}</strong>
                <span>{spec.text}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --- process ------------------------------------------------------- */}
      <section className="g-section g-process" id="process">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3>לוח אלובונד ← כרסום ← אדנית</h3>
            <p>שלושה שלבים, בלי ריתוך ובלי תבנית. זה כל הסיפור.</p>
          </div>
          <ol className="g-process-row">
            {PROCESS.map((item, index) => (
              <li key={item.step} className="g-process-step">
                <span className="g-process-icon"><item.icon size={22} aria-hidden="true" /></span>
                <span className="g-process-num">{item.step}</span>
                <h4>{item.title}</h4>
                <p>{item.text}</p>
                {index < PROCESS.length - 1 && <ArrowLeft className="g-process-arrow" size={20} aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* --- shop ---------------------------------------------------------- */}
      <section className="g-section g-shop" id="shop">
        <div className="g-wrap">
          <div className="g-section-head g-head-row">
            <div>
              <h3>הקטלוג</h3>
              <p>דגמים מוכנים שאפשר להזמין כמו שהם — או לפתוח בסטודיו ולשנות כל מידה.</p>
            </div>
            <a className="g-link-arrow" href="#studio" onClick={(event) => jump(event, '#studio')}>
              לכל הדגמים <ArrowLeft size={15} aria-hidden="true" />
            </a>
          </div>

          <div className="g-product-grid">
            {SHOP_IDS.map(catalogueItem).map((item) => (
              <article className="g-product" key={item.id}>
                <MediaSlot
                  src={media(`product-${item.id}`)}
                  label={`צילום מוצר: ${item.name}`}
                  ratio="1 / 1"
                  shape="square"
                />
                <h4>{item.name}</h4>
                <p className="g-product-cat">{item.category}</p>
                <p className="g-product-size">{item.size}</p>
                <p className="g-product-price">לפי מידה · הצעת מחיר</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- the range, in colour ------------------------------------------ */}
      {/* The catalogue above is one pot per card, which never shows how wide
          the range runs. This band does it in a single photograph. */}
      <section className="g-range">
        <div className="g-wrap g-range-inner">
          <div className="g-range-copy">
            <span className="g-eyebrow">כל מידה, כל גוון</span>
            <h3>אותה גאומטריה, בכל צבע שתבחרו</h3>
            <p>
              מאדנית שולחן בגובה 200 מ״מ ועד עמוד כניסה של שני מטר — וכל גוון RAL על אותו לוח.
              הגימור נבחר בנפרד מחומר הייצור, כך שהמידה והצבע אף פעם לא מתנגשים.
            </p>
            <ul className="g-swatches" aria-label="דוגמאות גוון">
              {RANGE_COLOURS.map((swatch) => (
                <li key={swatch.name}>
                  <i style={{ background: swatch.hex }} aria-hidden="true" />
                  {swatch.name}
                </li>
              ))}
            </ul>
          </div>
          <MediaSlot
            src={media('rangeColours')}
            label="צילום מערך: כל האדניות בכחול, ירוק, צהוב ואדום, בכל המידות"
            ratio="16 / 9"
            shape="soft"
            className="g-range-photo"
          />
        </div>
      </section>

      {/* --- featured ------------------------------------------------------ */}
      <section className="g-section g-featured">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3>מומלצים</h3>
            <p>שלושת הדגמים שהכי הרבה סטודיואים פותחים ראשונים.</p>
          </div>
          <div className="g-featured-grid">
            {FEATURED_IDS.map(catalogueItem).map((item) => (
              <article className="g-featured-card" key={item.id}>
                <MediaSlot src={media(`featured-${item.id}`)} label={`צילום מוצר: ${item.name}`} ratio="4 / 5" shape="soft" />
                <div className="g-featured-body">
                  <h4>{item.name}</h4>
                  <p>{item.note}</p>
                  <span className="g-product-size">{item.size}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- categories ---------------------------------------------------- */}
      <section className="g-section g-categories">
        <div className="g-wrap g-cat-columns">
          {CATEGORY_COLUMNS.map((column) => (
            <div className="g-cat-column" key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.ids.map(catalogueItem).map((item) => (
                  <li key={item.id}>
                    <MediaSlot src={media(`cat-${item.id}`)} label={`צילום: ${item.name}`} ratio="1 / 1" shape="soft" className="g-cat-thumb" quiet />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.size}</span>
                    </div>
                    <ArrowLeft size={16} aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* --- audience ------------------------------------------------------ */}
      <section className="g-section g-audience" id="audience">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3>למי זה מיועד</h3>
            <p>מעצבי פנים, אמנים ובעלי מלאכה — וגם מי שרוצה אדנית אחת למרפסת.</p>
          </div>
          <div className="g-audience-grid">
            {AUDIENCE.map((item) => (
              <article className="g-audience-card" key={item.title}>
                <span className="g-audience-icon"><item.icon size={20} aria-hidden="true" /></span>
                <h4>{item.title}</h4>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- the studio ---------------------------------------------------- */}
      <section className="g-studio" id="studio">
        <div className="g-wrap">
          <div className="g-studio-head">
            <div>
              <span className="g-eyebrow">עריכת אדניות ON-LINE</span>
              <h3>עצבו אדנית, וצרו גאומטריה חדשה</h3>
              <p>
                כל שינוי מחושב על הגאומטריה האמיתית: הפריסה, זוויות הקיפול והקינון על גיליון הגלם.
                כשהבדיקה ירוקה — הקובץ מוכן לכרסם.
              </p>
            </div>
            <div className="g-studio-aside">
              <p className={`g-studio-status ${status.blocking ? 'blocked' : 'ok'}`}>
                <i aria-hidden="true" />
                {status.blocking ? 'לא ניתן לייצור' : 'מוכן לכרסום'}
                {status.readout.length > 0 && <small>{status.readout.join(' · ')}</small>}
              </p>
              <Link className="g-btn" href="/planter/studio">
                מסך עריכה מלא <ArrowLeft size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <div className="g-studio-frame">
          <div className="workspace garden-workspace">
            <PlanterStudioHe onStatus={setStatus} />
          </div>
        </div>
      </section>

      {/* --- features ------------------------------------------------------ */}
      <section className="g-section g-features">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3>למה כאן</h3>
            <p>שש סיבות שחוזרות בכל שיחה ראשונה.</p>
          </div>
          <div className="g-feature-grid">
            {FEATURES.map((item) => (
              <article className="g-feature" key={item.title}>
                <span className="g-feature-icon"><item.icon size={19} aria-hidden="true" /></span>
                <div>
                  <h4>{item.title}</h4>
                  <p>{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- testimonials -------------------------------------------------- */}
      <section className="g-section g-testimonials">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3>ממליצים</h3>
            <p>הציטוטים כאן הם מסגרת בלבד — נחליף אותם בהמלצות אמיתיות יחד עם המדיה.</p>
          </div>
          <div className="g-quote-row">
            {TESTIMONIALS.map((item, index) => (
              <figure className="g-quote" key={index}>
                <span className="g-sample">לדוגמה</span>
                <Quote size={18} aria-hidden="true" />
                <blockquote><p>{item.text}</p></blockquote>
                <figcaption>{item.name} · {item.role}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* --- blog ---------------------------------------------------------- */}
      <section className="g-section g-blog" id="blog">
        <div className="g-wrap">
          <div className="g-section-head g-head-row">
            <div>
              <h3>מהבלוג</h3>
              <p>חומר, כרסום ושתילה — מה שכדאי לדעת לפני שמזמינים.</p>
            </div>
            <a className="g-link-arrow" href="#contact" onClick={(event) => jump(event, '#contact')}>
              לכל הכתבות <ArrowLeft size={15} aria-hidden="true" />
            </a>
          </div>
          <div className="g-blog-grid">
            {POSTS.map((post, index) => (
              <article className="g-post" key={post.title}>
                <MediaSlot src={media(`post-${index + 1}`)} focus={mediaFocus(`post-${index + 1}`)} label={post.media} ratio="3 / 2" shape="soft" />
                <span className="g-tag">{post.tag}</span>
                <h4>{post.title}</h4>
                <span className="g-link-arrow">קרא עוד <ArrowLeft size={14} aria-hidden="true" /></span>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* --- instagram ----------------------------------------------------- */}
      <section className="g-section g-instagram">
        <div className="g-wrap">
          <div className="g-section-head">
            <h3><Instagram size={20} aria-hidden="true" /> אינסטגרם</h3>
            <p>@dxf.tlv</p>
          </div>
          <div className="g-insta-row">
            {Array.from({ length: 6 }, (_, index) => (
              <MediaSlot
                key={index}
                src={media(`insta-${index + 1}`)}
                focus={mediaFocus(`insta-${index + 1}`)}
                label={`פוסט ${index + 1}`}
                ratio="1 / 1"
                shape="square"
                quiet
              />
            ))}
          </div>
        </div>
      </section>

      {/* --- newsletter + footer ------------------------------------------- */}
      <footer className="g-footer" id="contact">
        <div className="g-wrap">
          <div className="g-newsletter">
            <div>
              <h3>נשארים מעודכנים</h3>
              <p>דגמים חדשים, מדריכי הרכבה ומבצעי גיליונות — מייל אחד בחודש, בלי ספאם.</p>
            </div>
            {/* Not wired to a list yet — it needs a backend endpoint before it can accept a real address. */}
            <form className="g-newsletter-form" onSubmit={(event) => event.preventDefault()}>
              <label className="sr-only" htmlFor="g-email">כתובת אימייל</label>
              <Mail size={16} aria-hidden="true" />
              <input id="g-email" type="email" placeholder="האימייל שלך" autoComplete="email" />
              <button type="submit" className="g-btn">הרשמה</button>
            </form>
          </div>

          <div className="g-footer-grid">
            <div className="g-footer-brand">
              <a className="g-brand" href="#top" onClick={(event) => jump(event, '#top')}><Brand /></a>
              <p>אדניות גאומטריות מקופלות מלוח ACM / ALUCOBOND אחד, מעוצבות אונליין ומיוצרות בכרסום CNC.</p>
              <p className="g-footer-contact">
                <a href={`tel:${PHONE_TEL}`}><Phone size={14} aria-hidden="true" /> {PHONE}</a>
                <a href={`mailto:${EMAIL}`}><Mail size={14} aria-hidden="true" /> {EMAIL}</a>
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div className="g-footer-col" key={column.title}>
                <h4>{column.title}</h4>
                <ul>{column.links.map((link) => <li key={link}><a href="#top" onClick={(event) => jump(event, '#top')}>{link}</a></li>)}</ul>
              </div>
            ))}
          </div>

          <div className="g-footer-bottom">
            <span>© {new Date().getFullYear()} DXF.TLV · כל הזכויות שמורות</span>
            <span>המדיה תתווסף בהמשך</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

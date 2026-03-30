/**
 * Converts XMind content.json → PlantUML @startmindmap syntax.
 *
 * Color resolution order:
 *   1. topic.style.properties["svg:fill"]  (inline per-node override)
 *   2. topic.styleId → styles.json styles[] lookup (named per-node style)
 *   3. Theme class by depth from styles.json master
 *      (centralTopic depth=0, mainTopic depth=1, subTopic depth≥2)
 *   4. Same lookup in content.json sheet.theme as fallback
 *   5. Omit color if nothing resolves to a hex value
 *
 * Text color: fo:color resolved the same way → <color:#HEX>text</color>
 */

interface XMindProperty {
  'svg:fill'?: string;
  'fo:color'?: string;
  'fill-pattern'?: string;
  [key: string]: string | undefined;
}

interface XMindThemeEntry {
  id?: string;
  properties?: XMindProperty;
}

interface XMindTheme {
  map?: XMindThemeEntry;
  centralTopic?: XMindThemeEntry;
  mainTopic?: XMindThemeEntry;
  subTopic?: XMindThemeEntry;
  floatingTopic?: XMindThemeEntry;
  importantTopic?: XMindThemeEntry;
  minorTopic?: XMindThemeEntry;
  [key: string]: XMindThemeEntry | undefined;
}

interface XMindStyle {
  properties?: XMindProperty;
  [key: string]: unknown;
}

interface XMindTopic {
  id: string;
  title?: string;
  class?: string;
  styleId?: string;
  style?: XMindStyle;
  children?: {
    attached?: XMindTopic[];
    detached?: XMindTopic[];
  };
  [key: string]: unknown;
}

interface XMindSheet {
  rootTopic: XMindTopic;
  theme?: XMindTheme;
  title?: string;
}

/** Parsed from styles.json in the .xmind ZIP */
export interface XMindStylesData {
  /** Per-depth theme colors (styles.json → master) */
  master?: XMindTheme;
  /** Per-node named styles keyed by style id (styles.json → styles[]) */
  stylesMap: Map<string, XMindProperty>;
}

/** Parse styles.json from a .xmind ZIP into usable color data */
export function parseXMindStyles(raw: string): XMindStylesData {
  try {
    const data = JSON.parse(raw);
    const stylesMap = new Map<string, XMindProperty>();

    // styles[] array — per-node named overrides
    const stylesArr = Array.isArray(data.styles) ? data.styles : [];
    for (const s of stylesArr) {
      if (s?.id && s?.properties) {
        stylesMap.set(String(s.id), s.properties as XMindProperty);
      }
    }

    // master — per-depth theme: { centralTopic, mainTopic, subTopic, ... }
    const master: XMindTheme = {};
    const masterRaw = data.master ?? data.theme ?? null;
    if (masterRaw && typeof masterRaw === 'object') {
      for (const key of ['centralTopic', 'mainTopic', 'subTopic', 'floatingTopic', 'importantTopic', 'minorTopic', 'map']) {
        if (masterRaw[key]) master[key] = masterRaw[key];
      }
    }

    return { master: Object.keys(master).length ? master : undefined, stylesMap };
  } catch {
    return { stylesMap: new Map() };
  }
}

function isHex(value: string | undefined): value is string {
  return !!value && value.startsWith('#');
}

/** Returns '#ffffff' or '#000000' depending on perceived luminance of a hex color. */
function contrastColor(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Perceived luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

function themeClassForDepth(depth: number, floating: boolean): string {
  if (floating) return 'floatingTopic';
  if (depth === 0) return 'centralTopic';
  if (depth === 1) return 'mainTopic';
  return 'subTopic';
}

/**
 * Look up prop in a single theme entry — no walk-up.
 * Each depth class is independent; "inherited" here means "no override" → null.
 */
function resolveThemeProp(
  theme: XMindTheme | undefined,
  classKey: string,
  prop: 'svg:fill' | 'fo:color',
): string | null {
  if (!theme) return null;
  const val = theme[classKey]?.properties?.[prop];
  return isHex(val) ? val : null;
}

/**
 * Parse the space-separated color-list from theme.map.properties.
 * Returns empty array if not present.
 */
export function parseColorList(sheetTheme: XMindTheme | undefined): string[] {
  // multi-line-colors are the lighter branch line colors (preferred); fall back to color-list
  const raw =
    sheetTheme?.map?.properties?.['multi-line-colors'] ??
    sheetTheme?.map?.properties?.['color-list'];
  if (!raw) return [];
  return raw.trim().split(/\s+/).filter(isHex);
}

function resolveColor(
  topic: XMindTopic,
  stylesData: XMindStylesData,
  sheetTheme: XMindTheme | undefined,
  depth: number,
  floating: boolean,
  prop: 'svg:fill' | 'fo:color',
  /** Color inherited from depth-1 ancestor (color-list slot), if any */
  branchColor: string | null,
): string | null {
  // 1. Per-node inline hex override
  const nodeVal = topic.style?.properties?.[prop];
  if (isHex(nodeVal)) return nodeVal;

  // fill-pattern:none → transparent, treat as no color
  if (prop === 'svg:fill' && topic.style?.properties?.['fill-pattern'] === 'none') {
    return null;
  }

  // 2. Named style referenced by styleId (from styles.json styles[])
  if (topic.styleId) {
    const styleProps = stylesData.stylesMap.get(topic.styleId);
    if (styleProps) {
      if (styleProps['fill-pattern'] === 'none' && prop === 'svg:fill') return null;
      const styleVal = styleProps[prop];
      if (isHex(styleVal)) return styleVal;
    }
  }

  // 3. Special class markers
  const markerClass = topic.class;
  if (markerClass === 'importantTopic' || markerClass === 'minorTopic') {
    return (
      resolveThemeProp(stylesData.master, markerClass, prop) ??
      resolveThemeProp(sheetTheme, markerClass, prop)
    );
  }

  // 4. Theme by depth — try styles.json master first, then content.json sheet theme
  const depthClass = themeClassForDepth(depth, floating);
  const themeColor =
    resolveThemeProp(stylesData.master, depthClass, prop) ??
    resolveThemeProp(sheetTheme, depthClass, prop);
  if (themeColor) return themeColor;

  // 5. For svg:fill on depth>=1 nodes: use the branch color from color-list
  //    (mainTopic with inherited fill + subTopics with fill-pattern:none both
  //    get their branch color on non-subTopic levels, none on subTopic)
  if (prop === 'svg:fill' && depth === 1 && branchColor) return branchColor;

  return null;
}

function countSubtree(topic: XMindTopic): number {
  let count = 1;
  for (const child of topic.children?.attached ?? []) {
    count += countSubtree(child);
  }
  return count;
}

function topicToPlantUml(
  topic: XMindTopic,
  depth: number,
  floating: boolean,
  stylesData: XMindStylesData,
  sheetTheme: XMindTheme | undefined,
  lines: string[],
  /** Color-list slot color assigned to this branch at depth 1 */
  branchColor: string | null,
): void {
  const prefix = '*'.repeat(depth + 1);
  const title = (topic.title ?? '').replace(/\n/g, ' ').trim() || '(empty)';

  const bgColor = resolveColor(topic, stylesData, sheetTheme, depth, floating, 'svg:fill', branchColor);
  const resolvedTextColor = resolveColor(topic, stylesData, sheetTheme, depth, floating, 'fo:color', branchColor);
  // If no explicit text color but there's a background, auto-derive contrast color
  const textColor = resolvedTextColor ?? (bgColor ? contrastColor(bgColor) : null);

  const textPart =
    textColor ? `<color:${textColor}>${title}</color>` : title;

  lines.push(bgColor ? `${prefix}[${bgColor}] ${textPart}` : `${prefix} ${textPart}`);

  for (const child of topic.children?.attached ?? []) {
    topicToPlantUml(child, depth + 1, false, stylesData, sheetTheme, lines, branchColor);
  }
}

export function convertXMindToPlantUml(
  sheets: XMindSheet[],
  stylesData: XMindStylesData = { stylesMap: new Map() },
): string {
  const allLines: string[] = [];

  for (const sheet of sheets) {
    const sheetTheme = sheet.theme;
    const lines: string[] = ['@startmindmap'];

    const root = sheet.rootTopic;

    // Emit root node (depth 0)
    const rootBg = resolveColor(root, stylesData, sheetTheme, 0, false, 'svg:fill', null);
    const rootResolvedText = resolveColor(root, stylesData, sheetTheme, 0, false, 'fo:color', null);
    const rootText = rootResolvedText ?? (rootBg ? contrastColor(rootBg) : null);
    const rootTitle = (root.title ?? '').replace(/\n/g, ' ').trim() || '(empty)';
    const rootTextPart = rootText ? `<color:${rootText}>${rootTitle}</color>` : rootTitle;
    lines.push(rootBg ? `*[${rootBg}] ${rootTextPart}` : `* ${rootTextPart}`);

    // color-list: XMind's "rainbow branches" — each depth-1 child gets a color slot
    const colorList = parseColorList(sheetTheme);

    // Split direct children into right/left by greedy weight balance
    const children = root.children?.attached ?? [];
    const rightChildren: XMindTopic[] = [];
    const leftChildren: XMindTopic[] = [];
    let rightWeight = 0;
    let leftWeight = 0;

    for (const child of children) {
      const w = countSubtree(child);
      if (rightWeight <= leftWeight) {
        rightChildren.push(child);
        rightWeight += w;
      } else {
        leftChildren.push(child);
        leftWeight += w;
      }
    }

    // Assign color-list slots in original order (right first, then left)
    const allMainTopics = [...rightChildren, ...leftChildren];
    const branchColorMap = new Map<string, string>();
    if (colorList.length > 0) {
      allMainTopics.forEach((child, i) => {
        branchColorMap.set(child.id, colorList[i % colorList.length]);
      });
    }

    // Right side subtrees
    for (const child of rightChildren) {
      topicToPlantUml(child, 1, false, stylesData, sheetTheme, lines, branchColorMap.get(child.id) ?? null);
    }

    // Left side subtrees
    if (leftChildren.length > 0) {
      lines.push('left side');
      for (const child of leftChildren) {
        topicToPlantUml(child, 1, false, stylesData, sheetTheme, lines, branchColorMap.get(child.id) ?? null);
      }
    }

    // Floating topics (detached children of root) — append on right
    const floating = root.children?.detached ?? [];
    for (const ft of floating) {
      topicToPlantUml(ft, 0, true, stylesData, sheetTheme, lines, null);
    }

    lines.push('@endmindmap');
    allLines.push(lines.join('\n'));
  }

  return allLines.join('\n\n');
}

export function parseXMindJson(raw: string): XMindSheet[] {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      throw new Error('Expected array of sheets');
    }
    return data as XMindSheet[];
  } catch (e: any) {
    throw new Error(`Invalid XMind content.json: ${e.message}`);
  }
}

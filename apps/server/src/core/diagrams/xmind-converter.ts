/**
 * Converts XMind content.json → PlantUML @startmindmap syntax.
 *
 * Color resolution per FRD:
 *   1. topic.style.properties["svg:fill"]  (per-node)
 *   2. Walk up ancestor chain while value is "inherited"
 *   3. Theme class by depth (centralTopic / mainTopic / subTopic / floatingTopic)
 *   4. Walk up theme hierarchy while still "inherited"
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

const THEME_DEPTH_KEYS = ['centralTopic', 'mainTopic', 'subTopic'];
const INHERITED = 'inherited';

function isHex(value: string | undefined): value is string {
  return !!value && value.startsWith('#');
}

function themeClassForDepth(depth: number, floating: boolean): string {
  if (floating) return 'floatingTopic';
  if (depth === 0) return 'centralTopic';
  if (depth === 1) return 'mainTopic';
  return 'subTopic';
}

function resolveThemeFill(
  theme: XMindTheme | undefined,
  classKey: string,
  prop: 'svg:fill' | 'fo:color',
): string | null {
  if (!theme) return null;
  // Walk up the theme hierarchy: subTopic → mainTopic → centralTopic
  const chain =
    classKey === 'subTopic'
      ? ['subTopic', 'mainTopic', 'centralTopic']
      : classKey === 'mainTopic'
        ? ['mainTopic', 'centralTopic']
        : classKey === 'floatingTopic'
          ? ['floatingTopic', 'centralTopic']
          : [classKey];

  for (const key of chain) {
    const val = theme[key]?.properties?.[prop];
    if (isHex(val)) return val;
    if (val && val !== INHERITED) return null; // non-hex, non-inherited → skip
  }
  return null;
}

function resolveColor(
  topic: XMindTopic,
  ancestors: XMindTopic[],
  theme: XMindTheme | undefined,
  depth: number,
  floating: boolean,
  prop: 'svg:fill' | 'fo:color',
): string | null {
  // 1. Per-node style
  const nodeVal = topic.style?.properties?.[prop];
  if (isHex(nodeVal)) return nodeVal;

  // fill-pattern:none → transparent, treat as no color
  if (prop === 'svg:fill' && topic.style?.properties?.['fill-pattern'] === 'none') {
    return null;
  }

  // 2. Walk ancestor chain if inherited
  if (!nodeVal || nodeVal === INHERITED) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const aVal = ancestors[i].style?.properties?.[prop];
      if (isHex(aVal)) return aVal;
      if (aVal && aVal !== INHERITED) break;
    }
  }

  // 3+4. Theme class fallback
  // Check special class markers first
  const markerClass = topic.class;
  if (markerClass === 'importantTopic' || markerClass === 'minorTopic') {
    const val = theme?.[markerClass]?.properties?.[prop];
    if (isHex(val)) return val;
  }

  const depthClass = themeClassForDepth(depth, floating);
  return resolveThemeFill(theme, depthClass, prop);
}

function topicToPlantUml(
  topic: XMindTopic,
  depth: number,
  floating: boolean,
  theme: XMindTheme | undefined,
  ancestors: XMindTopic[],
  lines: string[],
): void {
  const prefix = '*'.repeat(depth + 1);
  const title = (topic.title ?? '').replace(/\n/g, ' ').trim() || '(empty)';

  const bgColor = resolveColor(topic, ancestors, theme, depth, floating, 'svg:fill');
  const textColor = resolveColor(topic, ancestors, theme, depth, floating, 'fo:color');

  const colorPart = bgColor ? `[${bgColor}] ` : '';
  const textPart =
    textColor ? `<color:${textColor}>${title}</color>` : title;

  lines.push(`${prefix} ${colorPart}${textPart}`);

  const children = topic.children?.attached ?? [];
  const newAncestors = [...ancestors, topic];
  for (const child of children) {
    topicToPlantUml(child, depth + 1, false, theme, newAncestors, lines);
  }
}

export function convertXMindToPlantUml(sheets: XMindSheet[]): string {
  const allLines: string[] = [];

  for (const sheet of sheets) {
    const theme = sheet.theme;
    const lines: string[] = ['@startmindmap'];

    const root = sheet.rootTopic;
    topicToPlantUml(root, 0, false, theme, [], lines);

    // Floating topics (detached children of root)
    const floating = root.children?.detached ?? [];
    for (const ft of floating) {
      topicToPlantUml(ft, 0, true, theme, [], lines);
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

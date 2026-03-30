import { Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ExportMetadata } from '../../../common/helpers/types/export-metadata.types';

export async function buildAttachmentCandidates(
  extractDir: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  async function walk(dir: string) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
      } else {
        if (['.md', '.html'].includes(path.extname(ent.name).toLowerCase())) {
          continue;
        }

        const rel = path.relative(extractDir, abs).split(path.sep).join('/');
        map.set(rel, abs);
      }
    }
  }

  await walk(extractDir);
  return map;
}

export function resolveRelativeAttachmentPath(
  raw: string,
  pageDir: string,
  attachmentCandidates: Map<string, string>,
): string | null {
  let mainRel = raw.replace(/^\.?\/+/, '');
  try {
    mainRel = decodeURIComponent(mainRel);
  } catch (err) {
    Logger.warn(
      `URI malformed for attachment path: ${mainRel}. Falling back to raw path.`,
      'ImportUtils',
    );
  }
  const fallback = path
    .normalize(path.join(pageDir, mainRel))
    .split(path.sep)
    .join('/');

  if (attachmentCandidates.has(mainRel)) {
    return mainRel;
  }
  if (attachmentCandidates.has(fallback)) {
    return fallback;
  }
  return null;
}

export async function collectMarkdownAndHtmlFiles(
  dir: string,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(current, ent.name);
      if (ent.isDirectory()) {
        await walk(fullPath);
      } else if (
        ['.md', '.html'].includes(path.extname(ent.name).toLowerCase())
      ) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

export function stripNotionID(fileName: string): string {
  // Handle optional separator (space or dash) + 32 alphanumeric chars at end
  const notionIdPattern = /[ -]?[a-z0-9]{32}$/i;
  // Handle partial UUID format used for duplicate names: "Name abcd-ef12"
  const partialIdPattern = / [a-f0-9]{4}-[a-f0-9]{4}$/i;
  return fileName
    .replace(notionIdPattern, '')
    .replace(partialIdPattern, '')
    .trim();
}

/**
 * Extract a partial Notion UUID suffix from a folder name.
 * Notion adds "{first4}-{last4}" when multiple pages share the same title.
 * e.g. "Cool 324d-35ab" → { prefix: "324d", suffix: "35ab" }
 */
export function extractNotionPartialId(
  folderName: string,
): { prefix: string; suffix: string } | null {
  const match = folderName.match(/ ([a-f0-9]{4})-([a-f0-9]{4})$/i);
  if (!match) return null;
  return { prefix: match[1].toLowerCase(), suffix: match[2].toLowerCase() };
}

export function encodeFilePath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export async function readDocmostMetadata(
  extractDir: string,
): Promise<ExportMetadata | null> {
  const metadataPath = path.join(extractDir, 'docmost-metadata.json');
  try {
    const content = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(content) as ExportMetadata;
    if (metadata.source === 'docmost' && metadata.pages) {
      return metadata;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractDatesFromProperties(
  properties: { key: string; value: string | string[] }[],
): { createdAt?: Date; updatedAt?: Date } {
  let createdAt: Date | undefined;
  let updatedAt: Date | undefined;
  for (const prop of properties) {
    const k = prop.key.toLowerCase();
    const v = Array.isArray(prop.value) ? prop.value[0] : prop.value;
    if (!v) continue;
    const parsed = new Date(v);
    if (isNaN(parsed.getTime())) continue;
    if ((k === 'created' || k === 'date') && !createdAt) {
      createdAt = parsed;
    }
    if ((k === 'updated' || k === 'modified') && !updatedAt) {
      updatedAt = parsed;
    }
  }
  return { createdAt, updatedAt };
}

export function selectLongerTitle(
  a: string | undefined | null,
  b: string | undefined | null,
): string | undefined {
  const aLen = a?.length ?? 0;
  const bLen = b?.length ?? 0;
  if (aLen === 0 && bLen === 0) return undefined;
  return aLen >= bLen ? (a ?? undefined) : (b ?? undefined);
}

// Month-name → 1-based month index for common locales (OneNote UI languages)
const MONTH_MAP: Record<string, number> = {
  // English
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
  // Russian (genitive, as OneNote uses)
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
  // Ukrainian
  'січня': 1, 'лютого': 2, 'березня': 3, 'квітня': 4, 'травня': 5, 'червня': 6,
  'липня': 7, 'серпня': 8, 'вересня': 9, 'жовтня': 10, 'листопада': 11, 'грудня': 12,
  // German (august/september/november same spelling as EN — already above)
  'januar': 1, 'februar': 2, 'märz': 3, 'mai': 5, 'juni': 6,
  'juli': 7, 'oktober': 10, 'dezember': 12,
  // French
  'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4, 'juin': 6,
  'juillet': 7, 'août': 8, 'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12,
  // Spanish
  'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
  'julio': 7, 'agosto': 8, 'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
  // Italian (marzo/agosto same as ES; novembre same as FR — already above)
  'gennaio': 1, 'febbraio': 2, 'aprile': 4, 'maggio': 5, 'giugno': 6,
  'luglio': 7, 'settembre': 9, 'ottobre': 10, 'dicembre': 12,
  // Portuguese (abril/agosto same as ES — already above; março has cedilla so unique)
  'janeiro': 1, 'fevereiro': 2, 'março': 3, 'maio': 5, 'junho': 6,
  'julho': 7, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
  // Dutch (juni/juli/september/oktober/november/december same as DE/EN — already above)
  'januari': 1, 'februari': 2, 'maart': 3, 'mei': 5, 'augustus': 8,
  // Polish
  'stycznia': 1, 'lutego': 2, 'marca': 3, 'kwietnia': 4, 'maja': 5, 'czerwca': 6,
  'lipca': 7, 'sierpnia': 8, 'września': 9, 'października': 10, 'listopada': 11, 'grudnia': 12,
  // Korean (월 = month suffix, stripping it below)
  '1월': 1, '2월': 2, '3월': 3, '4월': 4, '5월': 5, '6월': 6,
  '7월': 7, '8월': 8, '9월': 9, '10월': 10, '11월': 11, '12월': 12,
  // Japanese (月 suffix)
  '1月': 1, '2月': 2, '3月': 3, '4月': 4, '5月': 5, '6月': 6,
  '7月': 7, '8月': 8, '9月': 9, '10月': 10, '11月': 11, '12月': 12,
};

/**
 * Parse a OneNote-style localized date/time pair extracted from the Joplin HTML body title.
 * Examples:
 *   "24 марта 2019 г." + "14:05"  →  2019-03-24T14:05:00
 *   "March 24, 2019"  + "2:05 PM" →  2019-03-24T14:05:00
 * Returns undefined if parsing fails.
 */
export function parseJoplinBodyDate(
  dateText: string,
  timeText?: string,
): Date | undefined {
  const dt = dateText.trim().replace(/\s+/g, ' ');
  const tt = timeText?.trim() ?? '';

  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;

  // Pattern 1: "24 марта 2019 г." or "24 March 2019" — day monthName year
  const p1 = dt.match(/^(\d{1,2})\s+([\p{L}]+)\s+(\d{4})/u);
  if (p1) {
    day = parseInt(p1[1], 10);
    month = MONTH_MAP[p1[2].toLowerCase()];
    year = parseInt(p1[3], 10);
  }

  // Pattern 2: "March 24, 2019" — monthName day, year
  if (!month) {
    const p2 = dt.match(/^([\p{L}]+)\s+(\d{1,2}),?\s+(\d{4})/u);
    if (p2) {
      month = MONTH_MAP[p2[1].toLowerCase()];
      day = parseInt(p2[2], 10);
      year = parseInt(p2[3], 10);
    }
  }

  // Pattern 3: numeric  dd.mm.yyyy or mm/dd/yyyy or yyyy-mm-dd
  if (!month) {
    const p3a = dt.match(/^(\d{1,2})[\.](\d{1,2})[\.](\d{4})/);
    if (p3a) {
      day = parseInt(p3a[1], 10); month = parseInt(p3a[2], 10); year = parseInt(p3a[3], 10);
    }
    const p3b = dt.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (p3b) {
      year = parseInt(p3b[1], 10); month = parseInt(p3b[2], 10); day = parseInt(p3b[3], 10);
    }
  }

  if (!day || !month || !year) return undefined;

  let hours = 0;
  let minutes = 0;
  if (tt) {
    // "14:05" or "2:05 PM" or "2:05:00 PM"
    const tm = tt.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (tm) {
      hours = parseInt(tm[1], 10);
      minutes = parseInt(tm[2], 10);
      if (tm[3]?.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (tm[3]?.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
  }

  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return isNaN(d.getTime()) ? undefined : d;
}

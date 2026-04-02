import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { MultipartFile } from '@fastify/multipart';
import { sanitize } from 'sanitize-filename-ts';
import * as path from 'path';
import {
  htmlToJson,
  jsonToText,
  tiptapExtensions,
} from '../../../collaboration/collaboration.util';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  generateSlugId,
  sanitizeFileName,
  createByteCountingStream,
} from '../../../common/helpers';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import {
  markdownToHtml,
  extractFrontmatter,
  parseYamlFrontmatter,
} from '@docmost/editor-ext';
import { load } from 'cheerio';
import {
  extractDatesFromProperties,
  parseJoplinBodyDate,
  selectLongerTitle,
} from '../utils/import.utils';
import {
  FileTaskStatus,
  FileTaskType,
  getFileTaskFolderPath,
} from '../utils/file.utils';
import { v7 as uuid7 } from 'uuid';
import { StorageService } from '../../storage/storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueJob, QueueName } from '../../queue/constants';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly pageRepo: PageRepo,
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.FILE_TASK_QUEUE)
    private readonly fileTaskQueue: Queue,
    private moduleRef: ModuleRef,
  ) {}

  async importPage(
    filePromise: Promise<MultipartFile>,
    userId: string,
    spaceId: string,
    workspaceId: string,
    overwrite = false,
  ) {
    const file = await filePromise;
    const fileBuffer = await file.toBuffer();
    const fileExtension = path.extname(file.filename).toLowerCase();
    const fileName = sanitize(
      path.basename(file.filename, fileExtension).slice(0, 255),
    );
    const fileContent = fileBuffer.toString();

    let prosemirrorState = null;
    let importedProperties: any[] = [];
    let createdPage = null;
    let frontmatterDates: { createdAt?: Date; updatedAt?: Date } = {};
    let titleOverride: string | undefined;

    // For DOCX, we need the page ID upfront so images can reference it
    const pageId = fileExtension === '.docx' ? uuid7() : undefined;

    try {
      if (fileExtension.endsWith('.md')) {
        const mdResult = await this.processMarkdown(fileContent);
        prosemirrorState = mdResult.pmDoc;
        importedProperties = mdResult.properties;
        const fm = extractFrontmatter(fileContent);
        if (fm) {
          frontmatterDates = extractDatesFromProperties(
            parseYamlFrontmatter(fm.yaml),
          );
        }
      } else if (fileExtension.endsWith('.html')) {
        const fm = extractFrontmatter(fileContent);
        const htmlBody = fm ? fm.body : fileContent;
        if (fm) {
          const props = parseYamlFrontmatter(fm.yaml);
          importedProperties = props;
          const fmTitleProp = props.find(
            (p) => p.key.toLowerCase() === 'title',
          );
          const fmTitle = fmTitleProp
            ? Array.isArray(fmTitleProp.value)
              ? fmTitleProp.value[0]
              : fmTitleProp.value
            : undefined;
          const { cleanHtml, bodyTitle, bodyDate } =
            this.processJoplinHtml(htmlBody);
          titleOverride = selectLongerTitle(bodyTitle, fmTitle);
          if (bodyDate) frontmatterDates = { createdAt: bodyDate };
          prosemirrorState = await this.processHTML(cleanHtml);
        } else {
          const { cleanHtml, bodyTitle, bodyDate } =
            this.processJoplinHtml(fileContent);
          titleOverride = bodyTitle;
          if (bodyDate) frontmatterDates = { createdAt: bodyDate };
          prosemirrorState = await this.processHTML(cleanHtml);
        }
      } else if (fileExtension.endsWith('.docx')) {
        prosemirrorState = await this.processDocx(
          fileBuffer,
          workspaceId,
          spaceId,
          pageId,
          userId,
        );
      }
    } catch (err) {
      const message = 'Error processing file content';
      this.logger.error(message, err);
      throw new BadRequestException(message);
    }

    if (!prosemirrorState) {
      const message = 'Failed to create ProseMirror state';
      this.logger.error(message);
      throw new BadRequestException(message);
    }

    const { title, prosemirrorJson } =
      this.extractTitleAndRemoveHeading(prosemirrorState);

    const pageTitle = title || titleOverride || fileName;

    if (prosemirrorJson) {
      try {
        const ydoc = await this.createYdoc(prosemirrorJson, importedProperties);
        const content = prosemirrorJson;
        const textContent = jsonToText(prosemirrorJson);

        if (overwrite) {
          const existing = await this.pageRepo.findByTitleInSpace(
            pageTitle,
            spaceId,
            null,
          );
          if (existing) {
            await this.pageRepo.updatePage(
              {
                title: pageTitle,
                content,
                textContent,
                ydoc,
                lastUpdatedById: userId,
                workspaceId,
                ...(frontmatterDates.updatedAt
                  ? { updatedAt: frontmatterDates.updatedAt }
                  : {}),
              },
              existing.id,
            );
            createdPage = { ...existing, title: pageTitle };
            this.logger.debug(
              `Overwrote existing page "${pageTitle}" (ID: ${existing.id})`,
            );
            return createdPage;
          }
        }

        const pagePosition = await this.getNewPagePosition(spaceId);

        createdPage = await this.pageRepo.insertPage({
          ...(pageId ? { id: pageId } : {}),
          slugId: generateSlugId(),
          title: pageTitle,
          content,
          textContent,
          ydoc,
          position: pagePosition,
          spaceId: spaceId,
          creatorId: userId,
          workspaceId: workspaceId,
          lastUpdatedById: userId,
          ...(frontmatterDates.createdAt
            ? { createdAt: frontmatterDates.createdAt }
            : {}),
          ...(frontmatterDates.updatedAt
            ? { updatedAt: frontmatterDates.updatedAt }
            : {}),
        });

        this.logger.debug(
          `Successfully imported "${title}${fileExtension}. ID: ${createdPage.id} - SlugId: ${createdPage.slugId}"`,
        );
      } catch (err) {
        const message = 'Failed to create imported page';
        this.logger.error(message, err);
        throw new BadRequestException(message);
      }
    }

    return createdPage;
  }

  async processMarkdown(
    markdownInput: string,
  ): Promise<{ pmDoc: any; properties: any[] }> {
    try {
      const frontmatter = extractFrontmatter(markdownInput);
      if (frontmatter) {
        const html = await markdownToHtml(frontmatter.body);
        const pmDoc = await this.processHTML(html);
        const properties = parseYamlFrontmatter(frontmatter.yaml);
        return { pmDoc, properties };
      }
      const html = await markdownToHtml(markdownInput);
      return { pmDoc: await this.processHTML(html), properties: [] };
    } catch (err) {
      throw err;
    }
  }

  async processHTML(htmlInput: string): Promise<any> {
    try {
      return htmlToJson(htmlInput);
    } catch (err) {
      throw err;
    }
  }

  /**
   * Process a Joplin-exported markdown note whose first lines may be:
   *   # Title
   *   (blank lines)
   *   Created: 2014-09-05 14:50:04 +0800
   *   (blank lines)
   *   Modified: 2021-11-27 23:19:13 +0700
   *   (blank lines)
   *   ---
   *
   * Strips those header lines and returns the extracted metadata.
   * Empty lines between header elements are skipped, not treated as terminators.
   */
  processJoplinMarkdown(markdown: string): {
    cleanMarkdown: string;
    bodyTitle: string | undefined;
    bodyDate: Date | undefined;
    modifiedDate: Date | undefined;
  } {
    const lines = markdown.split('\n');
    let bodyTitle: string | undefined;
    let bodyDate: Date | undefined;
    let modifiedDate: Date | undefined;

    const titleMatch = lines[0]?.match(/^#\s+(.+)/);
    if (!titleMatch) {
      return { cleanMarkdown: markdown, bodyTitle, bodyDate, modifiedDate };
    }

    bodyTitle = titleMatch[1].trim();

    // Indices of lines belonging to the Joplin header (title + meta + separator)
    const headerIndices = new Set<number>([0]);
    let foundSeparator = false;
    let foundNonBlankNonHeader = false;

    for (let i = 1; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();

      if (line === '') {
        // Blank lines inside header region — skip but don't stop scanning
        headerIndices.add(i);
        continue;
      }

      const createdMatch = line.match(/^Created:\s*(.+)$/i);
      if (createdMatch) {
        headerIndices.add(i);
        const d = this.parseJoplinDate(createdMatch[1].trim());
        if (d) bodyDate = d;
        continue;
      }

      const modifiedMatch = line.match(/^Modified:\s*(.+)$/i);
      if (modifiedMatch) {
        headerIndices.add(i);
        const d = this.parseJoplinDate(modifiedMatch[1].trim());
        if (d) modifiedDate = d;
        continue;
      }

      if (line === '---') {
        headerIndices.add(i);
        foundSeparator = true;
        break;
      }

      // Any other non-blank line ends the header scan
      foundNonBlankNonHeader = true;
      break;
    }

    // Only strip header if we got a clean terminator (separator or just meta lines)
    if (foundNonBlankNonHeader) {
      return { cleanMarkdown: markdown, bodyTitle, bodyDate, modifiedDate };
    }

    // Remove header lines; also remove leading blank lines that follow
    const cleanLines = lines.filter((_, idx) => !headerIndices.has(idx));
    while (cleanLines.length > 0 && cleanLines[0].trim() === '') {
      cleanLines.shift();
    }

    return { cleanMarkdown: cleanLines.join('\n'), bodyTitle, bodyDate, modifiedDate };
  }

  /**
   * Parse Joplin's date format: "2014-09-05 14:50:04 +0800"
   * (space instead of T, timezone without colon — not standard ISO 8601)
   */
  private parseJoplinDate(value: string): Date | undefined {
    // Normalize "YYYY-MM-DD HH:MM:SS +HHMM" → "YYYY-MM-DDTHH:MM:SS+HH:MM"
    const normalized = value
      .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-])(\d{2})(\d{2})$/, '$1T$2$3$4:$5');
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) return d;
    // Fallback to standard ISO / RFC
    const d2 = new Date(value);
    if (!isNaN(d2.getTime())) return d2;
    return undefined;
  }

  processJoplinHtml(html: string): {
    cleanHtml: string;
    bodyTitle: string | undefined;
    bodyDate: Date | undefined;
  } {
    const $ = load(html);
    const titleDiv = $('body > div.title').first();
    let bodyTitle: string | undefined;
    let bodyDate: Date | undefined;
    if (titleDiv.length) {
      const containers = titleDiv.find('.container-outline');
      const text = containers.first().find('span').first().text().trim();
      if (text) bodyTitle = text;
      // Second container has date (index 0) and time (index 1) outline-elements
      if (containers.length >= 2) {
        const dateSpans = containers.eq(1).find('.outline-element span');
        const dateText = dateSpans.eq(0).text().trim();
        const timeText = dateSpans.eq(1).text().trim();
        bodyDate = parseJoplinBodyDate(dateText, timeText);
      }
      titleDiv.remove();
    }
    return { cleanHtml: $.html(), bodyTitle, bodyDate };
  }

  async processDocx(
    fileBuffer: Buffer,
    workspaceId: string,
    spaceId: string,
    pageId: string,
    userId: string,
  ): Promise<any> {
    let DocxImportModule: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      DocxImportModule = require('./../../../ee/docx-import/docx-import.service');
    } catch (err) {
      this.logger.error(
        'DOCX import requested but EE module not bundled in this build',
      );
      throw new BadRequestException(
        'This feature requires a valid enterprise license.',
      );
    }

    const docxImportService = this.moduleRef.get(
      DocxImportModule.DocxImportService,
      { strict: false },
    );

    const html = await docxImportService.convertDocxToHtml(
      fileBuffer,
      workspaceId,
      spaceId,
      pageId,
      userId,
    );

    return this.processHTML(html);
  }

  async createYdoc(
    prosemirrorJson: any,
    properties: any[] = [],
  ): Promise<Buffer | null> {
    if (prosemirrorJson) {
      // this.logger.debug(`Converting prosemirror json state to ydoc`)

      const ydoc = TiptapTransformer.toYdoc(
        prosemirrorJson,
        'default',
        tiptapExtensions,
      );

      if (properties.length > 0) {
        ydoc.transact(() => {
          ydoc.getMap('properties').set('data', properties);
        });
      }

      return Buffer.from(Y.encodeStateAsUpdate(ydoc));
    }
    return null;
  }

  /**
   * Replace a page's ydoc content while preserving Yjs CRDT history.
   * By recording delete ops before inserting new content, connected clients
   * receive a proper replacement (delete old + insert new) rather than a merge
   * that would duplicate content.
   */
  replaceYdocContent(
    existingYdocBuffer: Buffer | null | undefined,
    prosemirrorJson: any,
    properties: any[],
  ): Buffer | null {
    if (!prosemirrorJson) return null;

    const newYdoc = TiptapTransformer.toYdoc(
      prosemirrorJson,
      'default',
      tiptapExtensions,
    );

    if (!existingYdocBuffer) {
      // No existing ydoc: use a fresh ydoc and just add properties
      if (properties.length > 0) {
        newYdoc.transact(() => {
          newYdoc.getMap('properties').set('data', properties);
        });
      }
      return Buffer.from(Y.encodeStateAsUpdate(newYdoc));
    }

    // Load the existing ydoc to maintain CRDT history
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(existingYdocBuffer));

    // Delete all existing content (records tombstones so clients see the deletion)
    const defaultFragment = doc.getXmlFragment('default');
    if (defaultFragment.length > 0) {
      doc.transact(() => {
        defaultFragment.delete(0, defaultFragment.length);
      });
    }

    // Merge new content into the existing ydoc
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(newYdoc));

    // Replace properties
    doc.transact(() => {
      const propsMap = doc.getMap('properties');
      if (properties.length > 0) {
        propsMap.set('data', properties);
      } else if (propsMap.has('data')) {
        propsMap.delete('data');
      }
    });

    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }

  extractTitleAndRemoveHeading(prosemirrorState: any) {
    let title: string | null = null;

    const content = prosemirrorState.content ?? [];

    if (
      content.length > 0 &&
      content[0].type === 'heading' &&
      content[0].attrs?.level === 1
    ) {
      title = content[0].content?.[0]?.text ?? null;
      content.shift();
    }

    // Strip a horizontal rule that immediately follows the heading.
    // Obsidian notes commonly have '---' right after '# Title' as a visual separator.
    if (content.length > 0 && content[0].type === 'horizontalRule') {
      content.shift();
    }

    // ensure at least one paragraph
    if (content.length === 0) {
      content.push({
        type: 'paragraph',
        content: [],
      });
    }

    return {
      title,
      prosemirrorJson: {
        ...prosemirrorState,
        content,
      },
    };
  }

  async getNewPagePosition(
    spaceId: string,
    parentPageId?: string,
  ): Promise<string> {
    let query = this.db
      .selectFrom('pages')
      .select(['id', 'position'])
      .where('spaceId', '=', spaceId)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1);

    if (parentPageId) {
      query = query.where('parentPageId', '=', parentPageId);
    } else {
      query = query.where('parentPageId', 'is', null);
    }

    const lastPage = await query.executeTakeFirst();

    if (lastPage) {
      return generateJitteredKeyBetween(lastPage.position, null);
    } else {
      return generateJitteredKeyBetween(null, null);
    }
  }

  async importZip(
    filePromise: Promise<MultipartFile>,
    source: string,
    userId: string,
    spaceId: string,
    workspaceId: string,
    overwrite = false,
    skipRoot = true,
  ) {
    const file = await filePromise;
    const fileExtension = path.extname(file.filename).toLowerCase();
    const fileName = sanitizeFileName(
      path.basename(file.filename, fileExtension),
    );
    const fileNameWithExt = fileName + fileExtension;

    const fileTaskId = uuid7();
    const filePath = `${getFileTaskFolderPath(FileTaskType.Import, workspaceId)}/${fileTaskId}/${fileNameWithExt}`;

    // upload file
    const { stream, getBytesRead } = createByteCountingStream(file.file);

    await this.storageService.upload(filePath, stream);

    const fileSize = getBytesRead();

    const fileTask = await this.db
      .insertInto('fileTasks')
      .values({
        id: fileTaskId,
        type: FileTaskType.Import,
        source: source,
        status: FileTaskStatus.Processing,
        fileName: fileNameWithExt,
        filePath: filePath,
        fileSize: fileSize,
        fileExt: 'zip',
        creatorId: userId,
        spaceId: spaceId,
        workspaceId: workspaceId,
      })
      .returningAll()
      .executeTakeFirst();

    await this.fileTaskQueue.add(QueueJob.IMPORT_TASK, {
      fileTaskId: fileTaskId,
      overwrite,
      skipRoot,
    });

    return fileTask;
  }
}

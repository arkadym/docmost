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
        const pagePosition = await this.getNewPagePosition(spaceId);

        createdPage = await this.pageRepo.insertPage({
          ...(pageId ? { id: pageId } : {}),
          slugId: generateSlugId(),
          title: pageTitle,
          content: prosemirrorJson,
          textContent: jsonToText(prosemirrorJson),
          ydoc: await this.createYdoc(prosemirrorJson, importedProperties),
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
    });

    return fileTask;
  }
}

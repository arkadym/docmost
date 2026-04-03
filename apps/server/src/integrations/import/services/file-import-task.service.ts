import { Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { jsonToText } from '../../../collaboration/collaboration.util';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  extractZip,
  FileImportSource,
  FileTaskStatus,
} from '../utils/file.utils';
import { StorageService } from '../../storage/storage.service';
import * as tmp from 'tmp-promise';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { ImportService } from './import.service';
import { promises as fs } from 'fs';
import { generateSlugId } from '../../../common/helpers';
import { v7 } from 'uuid';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { FileTask, InsertablePage } from '@docmost/db/types/entity.types';
import {
  markdownToHtml,
  extractFrontmatter,
  parseYamlFrontmatter,
} from '@docmost/editor-ext';
import { getProsemirrorContent } from '../../../common/helpers/prosemirror/utils';
import { formatImportHtml } from '../utils/import-formatter';
import {
  buildAttachmentCandidates,
  collectMarkdownAndHtmlFiles,
  encodeFilePath,
  extractDatesFromProperties,
  extractNotionPartialId,
  readDocmostMetadata,
  selectLongerTitle,
  stripNotionID,
} from '../utils/import.utils';
import { executeTx } from '@docmost/db/utils';
import { BacklinkRepo } from '@docmost/db/repos/backlink/backlink.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageHistoryRepo } from '@docmost/db/repos/page/page-history.repo';
import { ImportAttachmentService } from './import-attachment.service';
import { ModuleRef } from '@nestjs/core';
import { PageService } from '../../../core/page/services/page.service';
import { ImportPageNode } from '../dto/file-task-dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';

@Injectable()
export class FileImportTaskService {
  private readonly logger = new Logger(FileImportTaskService.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly importService: ImportService,
    private readonly pageService: PageService,
    private readonly backlinkRepo: BacklinkRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageHistoryRepo: PageHistoryRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly importAttachmentService: ImportAttachmentService,
    private moduleRef: ModuleRef,
    private eventEmitter: EventEmitter2,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async processZIpImport(fileTaskId: string, overwrite = false, skipRoot = true, createSummary = false): Promise<void> {
    const fileTask = await this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();

    if (!fileTask) {
      this.logger.log(`Import file task with ID ${fileTaskId} not found`);
      return;
    }

    if (fileTask.status === FileTaskStatus.Failed) {
      return;
    }

    if (fileTask.status === FileTaskStatus.Success) {
      this.logger.log('Imported task already processed.');
      return;
    }

    const { path: tmpZipPath, cleanup: cleanupTmpFile } = await tmp.file({
      prefix: 'docmost-import',
      postfix: '.zip',
      discardDescriptor: true,
    });

    const { path: tmpExtractDir, cleanup: cleanupTmpDir } = await tmp.dir({
      prefix: 'docmost-extract-',
      unsafeCleanup: true,
    });

    try {
      const fileStream = await this.storageService.readStream(
        fileTask.filePath,
      );
      await pipeline(fileStream, createWriteStream(tmpZipPath));
      await extractZip(tmpZipPath, tmpExtractDir);
    } catch (err) {
      await cleanupTmpFile();
      await cleanupTmpDir();

      throw err;
    }

    try {
      if (
        fileTask.source === FileImportSource.Generic ||
        fileTask.source === FileImportSource.Notion ||
        fileTask.source === FileImportSource.Joplin
      ) {
        await this.processGenericImport({
          extractDir: tmpExtractDir,
          fileTask,
          overwrite,
          skipRoot,
          createSummary,
        });
      }

      if (fileTask.source === FileImportSource.Confluence) {
        let ConfluenceModule: any;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          ConfluenceModule = require('./../../../ee/confluence-import/confluence-import.service');
        } catch (err) {
          this.logger.error(
            'Confluence import requested but EE module not bundled in this build',
          );
          return;
        }
        const confluenceImportService = this.moduleRef.get(
          ConfluenceModule.ConfluenceImportService,
          { strict: false },
        );

        await confluenceImportService.processConfluenceImport({
          extractDir: tmpExtractDir,
          fileTask,
        });
      }
      try {
        await this.updateTaskStatus(fileTaskId, FileTaskStatus.Success, null);
        await cleanupTmpFile();
        await cleanupTmpDir();
        // delete stored file on success
        await this.storageService.delete(fileTask.filePath);
      } catch (err) {
        this.logger.error(
          `Failed to delete import file from storage. Task ID: ${fileTaskId}`,
          err,
        );
      }
    } catch (err) {
      await cleanupTmpFile();
      await cleanupTmpDir();

      throw err;
    }
  }

  async processGenericImport(opts: {
    extractDir: string;
    fileTask: FileTask;
    overwrite?: boolean;
    skipRoot?: boolean;
    createSummary?: boolean;
  }): Promise<void> {
    const { extractDir, fileTask, overwrite = false, skipRoot = true, createSummary = false } = opts;
    const isNotion = fileTask.source === FileImportSource.Notion;
    const isJoplin = fileTask.source === FileImportSource.Joplin;
    const allFiles = await collectMarkdownAndHtmlFiles(extractDir);
    const attachmentCandidates = await buildAttachmentCandidates(extractDir);
    const docmostMetadata = await readDocmostMetadata(extractDir);

    const space = await this.db
      .selectFrom('spaces')
      .select(['slug'])
      .where('id', '=', fileTask.spaceId)
      .executeTakeFirst();

    const pagesMap = new Map<string, ImportPageNode>();

    for (const absPath of allFiles) {
      const relPath = path
        .relative(extractDir, absPath)
        .split(path.sep)
        .join('/'); // normalize to forward-slashes
      const ext = path.extname(relPath).toLowerCase();

      const encodedPath = encodeFilePath(relPath);
      const pageMetadata = docmostMetadata?.pages[encodedPath];

      pagesMap.set(relPath, {
        id: v7(),
        slugId: generateSlugId(),
        name: stripNotionID(path.basename(relPath, ext)),
        content: '',
        parentPageId: null,
        fileExtension: ext,
        filePath: relPath,
        icon: pageMetadata?.icon ?? null,
      });
    }

    // Create placeholder pages for folders without corresponding files
    const foldersWithContent = new Set<string>();

    pagesMap.forEach((page) => {
      const segments = page.filePath.split('/');
      segments.pop(); // remove filename

      // Build up all folder paths and mark them as having content
      let currentPath = '';
      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        foldersWithContent.add(currentPath); // All ancestor folders have content
      }
    });

    // Determine if there's a single root container folder to optionally skip
    let skipRootFolder: string | null = null;
    if (skipRoot) {
      const rootLevelItems = new Set<string>();
      pagesMap.forEach((page) => {
        rootLevelItems.add(page.filePath.split('/')[0]);
      });
      if (rootLevelItems.size === 1) {
        const onlyRoot = Array.from(rootLevelItems)[0];
        const hasRootFiles = Array.from(pagesMap.keys()).some(
          (fp) => !fp.includes('/'),
        );
        if (!hasRootFiles) {
          skipRootFolder = onlyRoot;
        }
      }
    }

    // For each folder with content, create a placeholder page if no corresponding .md or .html exists
    // Process folders with partial UUIDs first so they claim their specific files
    // before plain folders (without partial UUIDs) take whatever remains.
    const sortedFolders = isNotion
      ? [...foldersWithContent].sort((a, b) => {
          const aHasPartial = extractNotionPartialId(path.basename(a)) ? 0 : 1;
          const bHasPartial = extractNotionPartialId(path.basename(b)) ? 0 : 1;
          return aHasPartial - bHasPartial;
        })
      : [...foldersWithContent];

    sortedFolders.forEach((folderPath) => {
      if (
        skipRootFolder &&
        folderPath.toLowerCase() === skipRootFolder.toLowerCase()
      ) {
        return;
      }

      const mdPath = `${folderPath}.md`;
      const htmlPath = `${folderPath}.html`;

      if (!pagesMap.has(mdPath) && !pagesMap.has(htmlPath)) {
        const folderName = path.basename(folderPath);
        const parentDir = path.dirname(folderPath);

        // Notion no longer adds UUIDs to folder names, but still adds them to files.
        // For duplicate names, Notion adds a partial UUID "{first4}-{last4}" to the folder.
        let matched = false;
        if (isNotion) {
          const partialId = extractNotionPartialId(folderName);
          const strippedFolderName = stripNotionID(folderName);
          const isSameDir = (fileDir: string) =>
            fileDir === parentDir || (parentDir === '.' && !fileDir.includes('/'));

          for (const [filePath, page] of pagesMap.entries()) {
            if (!isSameDir(path.dirname(filePath))) continue;
            if (page.name !== strippedFolderName) continue;

            if (partialId) {
              // Match partial UUID against the full UUID in the filename
              const fileBase = path.basename(filePath, path.extname(filePath));
              const fullIdMatch = fileBase.match(/[a-f0-9]{32}$/i);
              if (!fullIdMatch) continue;
              const fullId = fullIdMatch[0].toLowerCase();
              if (!fullId.startsWith(partialId.prefix) || !fullId.endsWith(partialId.suffix)) {
                continue;
              }
            }

            pagesMap.delete(filePath);
            page.filePath = mdPath;
            pagesMap.set(mdPath, page);
            matched = true;
            break;
          }
        }

        if (!matched) {
          const encodedMdPath = encodeFilePath(mdPath);
          const placeholderMetadata = docmostMetadata?.pages[encodedMdPath];
          pagesMap.set(mdPath, {
            id: v7(),
            slugId: generateSlugId(),
            name: stripNotionID(folderName),
            content: '',
            parentPageId: null,
            fileExtension: '.md',
            filePath: mdPath,
            icon: placeholderMetadata?.icon ?? null,
          });
        }
      }
    });

    // parent/child linking
    pagesMap.forEach((page, filePath) => {
      const segments = filePath.split('/');
      segments.pop();
      let parentPage = null;
      while (segments.length) {
        const tryMd = segments.join('/') + '.md';
        const tryHtml = segments.join('/') + '.html';
        if (pagesMap.has(tryMd)) {
          parentPage = pagesMap.get(tryMd)!;
          break;
        }
        if (pagesMap.has(tryHtml)) {
          parentPage = pagesMap.get(tryHtml)!;
          break;
        }
        segments.pop();
      }
      if (parentPage) page.parentPageId = parentPage.id;
    });

    // generate position keys
    const siblingsMap = new Map<string | null, ImportPageNode[]>();

    pagesMap.forEach((page) => {
      const group = siblingsMap.get(page.parentPageId) ?? [];
      group.push(page);
      siblingsMap.set(page.parentPageId, group);
    });

    const encodedPathsMap = new Map<string, string>();
    if (docmostMetadata) {
      pagesMap.forEach((_, filePath) => {
        encodedPathsMap.set(filePath, encodeFilePath(filePath));
      });
    }

    // Sort siblings by metadata position if available, otherwise alphabetically
    const sortSiblings = (siblings: ImportPageNode[]) => {
      if (docmostMetadata) {
        siblings.sort((a, b) => {
          const posA =
            docmostMetadata.pages[encodedPathsMap.get(a.filePath)]?.position;
          const posB =
            docmostMetadata.pages[encodedPathsMap.get(b.filePath)]?.position;
          if (posA && posB) {
            // Use direct comparison to match PostgreSQL collation 'C' (byte order)
            if (posA < posB) return -1;
            if (posA > posB) return 1;
            return 0;
          }
          return a.name.localeCompare(b.name);
        });
      } else {
        siblings.sort((a, b) => a.name.localeCompare(b.name));
      }
    };

    // get root pages
    const rootSibs = siblingsMap.get(null);

    if (rootSibs?.length) {
      sortSiblings(rootSibs);

      // get first position key from the server
      const nextPosition = await this.pageService.nextPagePosition(
        fileTask.spaceId,
      );

      let prevPos: string | null = null;
      rootSibs.forEach((page, idx) => {
        if (idx === 0) {
          page.position = nextPosition;
        } else {
          page.position = generateJitteredKeyBetween(prevPos, null);
        }
        prevPos = page.position;
      });
    }

    // non-root buckets (children & deeper levels)
    siblingsMap.forEach((sibs, parentId) => {
      if (parentId === null) return; // root already done

      sortSiblings(sibs);

      let prevPos: string | null = null;
      for (const page of sibs) {
        page.position = generateJitteredKeyBetween(prevPos, null);
        prevPos = page.position;
      }
    });

    // internal page links
    const filePathToPageMetaMap = new Map<
      string,
      { id: string; title: string; slugId: string }
    >();
    pagesMap.forEach((page) => {
      filePathToPageMetaMap.set(page.filePath, {
        id: page.id,
        title: page.name,
        slugId: page.slugId,
      });
    });

    // Group pages by level (topological sort for parent-child relationships)
    const pagesByLevel = new Map<number, Array<[string, ImportPageNode]>>();
    const pageLevel = new Map<string, number>();

    // Calculate levels using BFS
    const calculateLevels = () => {
      const queue: Array<{ filePath: string; level: number }> = [];

      // Start with root pages (no parent)
      for (const [filePath, page] of pagesMap.entries()) {
        if (!page.parentPageId) {
          queue.push({ filePath, level: 0 });
          pageLevel.set(filePath, 0);
        }
      }

      // BFS to assign levels
      while (queue.length > 0) {
        const { filePath, level } = queue.shift()!;
        const currentPage = pagesMap.get(filePath)!;

        // Find children of current page
        for (const [childFilePath, childPage] of pagesMap.entries()) {
          if (
            childPage.parentPageId === currentPage.id &&
            !pageLevel.has(childFilePath)
          ) {
            pageLevel.set(childFilePath, level + 1);
            queue.push({ filePath: childFilePath, level: level + 1 });
          }
        }
      }

      // Group pages by level
      for (const [filePath, page] of pagesMap.entries()) {
        const level = pageLevel.get(filePath) || 0;
        if (!pagesByLevel.has(level)) {
          pagesByLevel.set(level, []);
        }
        pagesByLevel.get(level)!.push([filePath, page]);
      }
    };

    calculateLevels();

    if (pagesMap.size < 1) return;

    // Process pages level by level sequentially to respect foreign key constraints
    const allBacklinks: any[] = [];
    const validPageIds = new Set<string>();
    const pageTitles = new Map<string, string>();
    // Maps imported page UUID → existing DB page UUID (populated during overwrite)
    const pageIdRemap = new Map<string, string>();
    let totalPagesProcessed = 0;

    type ImportStatus = 'created' | 'updated' | 'unchanged';
    interface SummaryEntry { filePath: string; status: ImportStatus; }
    const summaryEntries: SummaryEntry[] = [];

    // Sort levels to process in order
    const sortedLevels = Array.from(pagesByLevel.keys()).sort((a, b) => a - b);

    try {
      await executeTx(this.db, async (trx) => {
        // Process pages level by level sequentially within the transaction
        for (const level of sortedLevels) {
          const levelPages = pagesByLevel.get(level)!;

          for (const [filePath, page] of levelPages) {
            const absPath = path.join(extractDir, filePath);
            let content = '';

            // Check if file exists (placeholder pages won't have physical files)
            try {
              await fs.access(absPath);
              content = await fs.readFile(absPath, 'utf-8');

              if (page.fileExtension.toLowerCase() === '.md') {
                const fm = extractFrontmatter(content);
                if (fm) {
                  // Store parsed properties so we can prepend the node after
                  // the HTML→ProseMirror conversion below.
                  page['_frontmatterYaml'] = fm.yaml;
                  content = await markdownToHtml(fm.body);
                } else if (isJoplin) {
                  // Joplin markdown notes start with: # Title\nCreated: ...\nModified: ...\n---
                  const { cleanMarkdown, bodyTitle, bodyDate, modifiedDate } =
                    this.importService.processJoplinMarkdown(content);
                  if (bodyTitle) page['_joplinBodyTitle'] = bodyTitle;
                  if (bodyDate) page['_bodyDate'] = bodyDate;
                  if (modifiedDate) page['_bodyModifiedDate'] = modifiedDate;
                  content = await markdownToHtml(cleanMarkdown);
                } else {
                  content = await markdownToHtml(content);
                }
              } else if (page.fileExtension.toLowerCase() === '.html') {
                const fm = extractFrontmatter(content);
                const htmlBody = fm ? fm.body : content;
                if (isJoplin) {
                  if (fm) {
                    page['_frontmatterYaml'] = fm.yaml;
                  }
                  const { cleanHtml, bodyTitle, bodyDate } =
                    this.importService.processJoplinHtml(htmlBody);
                  if (bodyTitle) page['_joplinBodyTitle'] = bodyTitle;
                  if (bodyDate) page['_bodyDate'] = bodyDate;
                  content = cleanHtml;
                } else {
                  content = htmlBody;
                }
              }
            } catch (err: any) {
              if (err?.code === 'ENOENT') {
                // Use empty content, title will be the folder name
                content = '';
              } else {
                throw err;
              }
            }

            const htmlContent =
              await this.importAttachmentService.processAttachments({
                html: content,
                pageRelativePath: page.filePath,
                extractDir,
                pageId: page.id,
                fileTask,
                attachmentCandidates,
              });

            const { html, backlinks, pageIcon } = await formatImportHtml({
              html: htmlContent,
              currentFilePath: page.filePath,
              filePathToPageMetaMap: filePathToPageMetaMap,
              creatorId: fileTask.creatorId,
              sourcePageId: page.id,
              workspaceId: fileTask.workspaceId,
              spaceSlug: space?.slug,
            });

            const pmState = getProsemirrorContent(
              await this.importService.processHTML(html),
            );

            let importedProperties: any[] = [];
            if (page['_frontmatterYaml']) {
              let properties =
                parseYamlFrontmatter(page['_frontmatterYaml']) ?? [];
              // When bodyDate is available (parsed from the OneNote title div),
              // clean up Joplin's inaccurate timestamps: drop 'updated'/'modified'
              // and replace 'created'/'date' with the real date from the body.
              if (isJoplin && page['_bodyDate']) {
                const bd = page['_bodyDate'] as Date;
                properties = properties.filter(
                  (p) =>
                    p.key.toLowerCase() !== 'updated' &&
                    p.key.toLowerCase() !== 'modified',
                );
                const createdProp = properties.find(
                  (p) =>
                    p.key.toLowerCase() === 'created' ||
                    p.key.toLowerCase() === 'date',
                );
                if (createdProp) createdProp.value = bd.toISOString();
              }
              importedProperties = properties;
              const fmDates = extractDatesFromProperties(properties);
              if (fmDates.createdAt || fmDates.updatedAt) {
                page['_dates'] = fmDates;
              }
              const fmTitleProp = properties.find(
                (p) => p.key.toLowerCase() === 'title',
              );
              if (fmTitleProp) {
                page['_fmTitle'] = Array.isArray(fmTitleProp.value)
                  ? fmTitleProp.value[0]
                  : fmTitleProp.value;
              }
              delete page['_frontmatterYaml'];
            }

            const { title, prosemirrorJson } =
              this.importService.extractTitleAndRemoveHeading(pmState);

            const bodyTitle = page['_joplinBodyTitle'] as string | undefined;
            const fmTitle = page['_fmTitle'] as string | undefined;
            const titleOverride = selectLongerTitle(bodyTitle, fmTitle);
            // Body date (from OneNote title div) takes priority over frontmatter dates
            // (which are Joplin processing timestamps, not the original note dates)
            const bodyDate = page['_bodyDate'] as Date | undefined;
            const bodyModifiedDate = page['_bodyModifiedDate'] as Date | undefined;
            const fmDates = page['_dates'] as
              | { createdAt?: Date; updatedAt?: Date }
              | undefined;
            const pageDates: { createdAt?: Date; updatedAt?: Date } = bodyDate
              ? {
                  createdAt: bodyDate,
                  ...(bodyModifiedDate ? { updatedAt: bodyModifiedDate } : {}),
                }
              : (fmDates ?? {});

            // Only let the extracted heading override the filename when it is
            // a genuine expansion of it (i.e. the filename is a prefix of the
            // header title). This prevents Joplin duplicate-file suffixes like
            // "_1" or date suffixes from being silently dropped:
            //   "Задачи_1" (filename) vs "Задачи" (header) → header does NOT
            //     start with filename "Задачи_1" → keep filename ✓
            //   "Тестовое задание" (filename) vs "Тестовое задание (простое)"
            //     (header) → header starts with filename → use header ✓
            const candidateTitle = title || titleOverride;
            const pageTitle =
              candidateTitle &&
              candidateTitle.toLowerCase().startsWith(page.name.toLowerCase())
                ? candidateTitle
                : page.name || candidateTitle || '';
            const ydoc = await this.importService.createYdoc(
              prosemirrorJson,
              importedProperties,
            );

            // Remap parentPageId if a parent was overwritten (imported id → existing db id)
            const resolvedParentPageId = page.parentPageId
              ? (pageIdRemap.get(page.parentPageId) ?? page.parentPageId)
              : page.parentPageId;

            const insertablePage: InsertablePage = {
              id: page.id,
              slugId: page.slugId,
              title: pageTitle,
              icon: page.icon || pageIcon || null,
              content: prosemirrorJson,
              textContent: jsonToText(prosemirrorJson),
              ydoc,
              position: page.position!,
              spaceId: fileTask.spaceId,
              workspaceId: fileTask.workspaceId,
              creatorId: fileTask.creatorId,
              lastUpdatedById: fileTask.creatorId,
              parentPageId: resolvedParentPageId,
              ...(pageDates?.createdAt
                ? { createdAt: pageDates.createdAt }
                : {}),
              ...(pageDates?.updatedAt
                ? { updatedAt: pageDates.updatedAt }
                : {}),
            };

            if (overwrite) {
              const existing = await this.pageRepo.findByTitleInSpace(
                pageTitle,
                fileTask.spaceId,
                resolvedParentPageId ?? null,
                trx,
              );
              if (existing) {
                // Compare plain-text content (whitespace-normalized) to skip
                // pages whose body hasn't actually changed. This avoids spurious
                // history entries and DB writes for notes that differ only in
                // blank lines or spacing.
                const normalize = (s: string | null | undefined) =>
                  (s ?? '').replace(/\s+/g, '');
                const incomingText = jsonToText(prosemirrorJson);
                const contentChanged =
                  normalize(incomingText) !== normalize(existing.textContent);

                if (!contentChanged) {
                  // Content identical — just wire up remap so children resolve
                  pageIdRemap.set(page.id, existing.id);
                  validPageIds.add(existing.id);
                  pageTitles.set(existing.id, pageTitle);
                  summaryEntries.push({ filePath: page.filePath, status: 'unchanged' });
                  totalPagesProcessed++;
                  continue;
                }

                // Save current page state as history before overwriting
                if (existing.content) {
                  await this.pageHistoryRepo.saveHistory(existing, { trx });
                }

                // Build a ydoc that properly replaces content while preserving
                // Yjs CRDT history (delete old + insert new) to avoid duplication
                const overwriteYdoc = this.importService.replaceYdocContent(
                  existing.ydoc as Buffer | null | undefined,
                  prosemirrorJson,
                  importedProperties,
                );

                await trx
                  .updateTable('pages')
                  .set({
                    title: pageTitle,
                    content: prosemirrorJson,
                    textContent: incomingText,
                    ydoc: overwriteYdoc,
                    lastUpdatedById: fileTask.creatorId,
                    updatedAt: new Date(),
                    ...(pageDates?.updatedAt
                      ? { updatedAt: pageDates.updatedAt }
                      : {}),
                  })
                  .where('id', '=', existing.id)
                  .execute();
                // Track imported id → existing db id so children resolve their parentPageId
                pageIdRemap.set(page.id, existing.id);
                validPageIds.add(existing.id);
                pageTitles.set(existing.id, pageTitle);
                summaryEntries.push({ filePath: page.filePath, status: 'updated' });
                allBacklinks.push(...backlinks.map((bl) => ({
                  ...bl,
                  sourcePageId:
                    bl.sourcePageId === page.id ? existing.id : bl.sourcePageId,
                })));
                totalPagesProcessed++;
                continue;
              }
            }

            await trx.insertInto('pages').values(insertablePage).execute();

            // Track valid page IDs, titles, and collect backlinks
            validPageIds.add(insertablePage.id);
            pageTitles.set(insertablePage.id, insertablePage.title);
            summaryEntries.push({ filePath: page.filePath, status: 'created' });
            allBacklinks.push(...backlinks);
            totalPagesProcessed++;

            // Log progress periodically
            if (totalPagesProcessed % 50 === 0) {
              this.logger.debug(`Processed ${totalPagesProcessed} pages...`);
            }
          }
        }

        const filteredBacklinks = allBacklinks.filter(
          ({ sourcePageId, targetPageId }) =>
            validPageIds.has(sourcePageId) && validPageIds.has(targetPageId),
        );

        // Insert backlinks in batches
        if (filteredBacklinks.length > 0) {
          const BACKLINK_BATCH_SIZE = 100;
          for (
            let i = 0;
            i < filteredBacklinks.length;
            i += BACKLINK_BATCH_SIZE
          ) {
            const backlinkChunk = filteredBacklinks.slice(
              i,
              Math.min(i + BACKLINK_BATCH_SIZE, filteredBacklinks.length),
            );
            await this.backlinkRepo.insertBacklink(backlinkChunk, trx);
          }
        }

        if (validPageIds.size > 0) {
          this.eventEmitter.emit(EventName.PAGE_CREATED, {
            pageIds: Array.from(validPageIds),
            workspaceId: fileTask.workspaceId,
          });
        }

        this.logger.log(
          `Successfully imported ${totalPagesProcessed} pages with ${filteredBacklinks.length} backlinks`,
        );
      });

      if (validPageIds.size > 0) {
        const auditPayloads = Array.from(validPageIds).map((pageId) => ({
          event: AuditEvent.PAGE_CREATED,
          resourceType: AuditResource.PAGE,
          resourceId: pageId,
          spaceId: fileTask.spaceId,
          metadata: {
            source: fileTask.source,
            fileTaskId: fileTask.id,
            title: pageTitles.get(pageId),
          },
        }));

        this.auditService.logBatchWithContext(auditPayloads, {
          workspaceId: fileTask.workspaceId,
          actorId: fileTask.creatorId,
          actorType: 'user',
        });
      }

      // Insert summary page outside main transaction so it never rolls back the import
      if (createSummary && summaryEntries.length > 0) {
        try {
          await this.insertImportSummaryPage(fileTask, summaryEntries);
        } catch (err) {
          this.logger.error('Failed to create import summary page:', err);
        }
      }
    } catch (error) {
      this.logger.error('Failed to import files:', error);
      throw new Error(`File import failed: ${error?.['message']}`);
    }
  }

  private async insertImportSummaryPage(
    fileTask: FileTask,
    entries: Array<{ filePath: string; status: 'created' | 'updated' | 'unchanged' }>,
  ): Promise<void> {
    const statusEmoji = { created: '🟢', updated: '🟡', unchanged: '⚪' };
    const now = new Date();

    const zipName = path.basename(fileTask.fileName, path.extname(fileTask.fileName));
    const pageTitle = `${zipName} import summary`;

    const created = entries.filter((e) => e.status === 'created').length;
    const updated = entries.filter((e) => e.status === 'updated').length;
    const unchanged = entries.filter((e) => e.status === 'unchanged').length;

    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);

    const tableRows = entries
      .map((e) => `| ${e.filePath} | ${statusEmoji[e.status]} ${e.status} |`)
      .join('\n');

    const markdown = `# ${pageTitle}

Imported: ${dateStr}

Total processed: ${entries.length} | 🟢 Created: ${created} | 🟡 Updated: ${updated} | ⚪ Unchanged: ${unchanged}

| File | Status |
|------|--------|
${tableRows}
`;

    const html = await markdownToHtml(markdown);
    const pmState = getProsemirrorContent(
      await this.importService.processHTML(html),
    );
    const { title, prosemirrorJson } =
      this.importService.extractTitleAndRemoveHeading(pmState);
    const ydoc = await this.importService.createYdoc(prosemirrorJson, []);

    const summaryPosition = generateJitteredKeyBetween(null, null);

    await this.db
      .insertInto('pages')
      .values({
        id: v7(),
        slugId: generateSlugId(),
        title: title ?? pageTitle,
        content: prosemirrorJson,
        textContent: jsonToText(prosemirrorJson),
        ydoc,
        position: summaryPosition,
        spaceId: fileTask.spaceId,
        workspaceId: fileTask.workspaceId,
        creatorId: fileTask.creatorId,
        lastUpdatedById: fileTask.creatorId,
        parentPageId: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }

  async getFileTask(fileTaskId: string) {
    return this.db
      .selectFrom('fileTasks')
      .selectAll()
      .where('id', '=', fileTaskId)
      .executeTakeFirst();
  }

  async updateTaskStatus(
    fileTaskId: string,
    status: FileTaskStatus,
    errorMessage?: string,
  ) {
    try {
      await this.db
        .updateTable('fileTasks')
        .set({ status: status, errorMessage, updatedAt: new Date() })
        .where('id', '=', fileTaskId)
        .execute();
    } catch (err) {
      this.logger.error(err);
    }
  }
}

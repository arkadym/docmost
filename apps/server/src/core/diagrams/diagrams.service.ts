import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../../integrations/storage/storage.service';
import { getAttachmentFolderPath } from '../attachment/attachment.utils';
import { AttachmentType } from '../attachment/attachment.constants';
import { v7 as uuid7 } from 'uuid';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectKysely } from 'nestjs-kysely';
import * as JSZip from 'jszip';
import { convertXMindToPlantUml, parseXMindJson, parseXMindStyles } from './xmind-converter';

@Injectable()
export class DiagramsService {
  private readonly logger = new Logger(DiagramsService.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async renderPlantUml(opts: {
    code: string;
    pageId: string;
    userId: string;
    spaceId: string;
    workspaceId: string;
    attachmentId?: string;
  }) {
    if (!opts.code?.trim()) {
      throw new BadRequestException('PlantUML code is required');
    }

    const svgBuffer = await this.callPlantUmlServer(opts.code);

    const fileName = 'diagram.plantuml.svg';
    const fileExt = '.svg';
    const mimeType = 'image/svg+xml';

    let attachmentId = opts.attachmentId ?? null;
    let isUpdate = false;

    if (attachmentId) {
      const existing = await this.attachmentRepo.findById(attachmentId);
      if (!existing) {
        throw new NotFoundException('Attachment not found');
      }
      if (
        existing.pageId !== opts.pageId ||
        existing.workspaceId !== opts.workspaceId
      ) {
        throw new BadRequestException('Attachment does not match page');
      }
      isUpdate = true;
    } else {
      attachmentId = uuid7();
    }

    const filePath = `${getAttachmentFolderPath(AttachmentType.File, opts.workspaceId)}/${attachmentId}/${fileName}`;

    await this.storageService.uploadStream(filePath, Readable.from(svgBuffer), {
      recreateClient: true,
    });

    if (isUpdate) {
      await this.attachmentRepo.updateAttachment(
        { fileSize: svgBuffer.length, updatedAt: new Date() },
        attachmentId,
      );
    } else {
      await this.db
        .insertInto('attachments')
        .values({
          id: attachmentId,
          filePath,
          fileName,
          fileSize: svgBuffer.length,
          mimeType,
          type: 'file',
          fileExt,
          creatorId: opts.userId,
          workspaceId: opts.workspaceId,
          pageId: opts.pageId,
          spaceId: opts.spaceId,
        })
        .execute();
    }

    return {
      id: attachmentId,
      fileName,
      fileSize: svgBuffer.length,
      updatedAt: new Date(),
    };
  }

  async convertXMind(fileBuffer: Buffer): Promise<string> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(fileBuffer);
    } catch (e: any) {
      throw new BadRequestException(`Invalid .xmind file: ${e.message}`);
    }

    const contentFile = zip.file('content.json');
    if (!contentFile) {
      throw new BadRequestException(
        'content.json not found in .xmind archive',
      );
    }

    const raw = await contentFile.async('string');

    const stylesFile = zip.file('styles.json');
    const stylesRaw = stylesFile ? await stylesFile.async('string') : null;
    const stylesData = stylesRaw ? parseXMindStyles(stylesRaw) : { stylesMap: new Map() };

    const sheets = parseXMindJson(raw);
    return convertXMindToPlantUml(sheets, stylesData);
  }

  private async callPlantUmlServer(code: string): Promise<Buffer> {
    const serverUrl = this.environmentService.getPlantUmlServerUrl();
    const url = `${serverUrl}/svg`;
    code = code.trim();

    this.logger.debug(`Calling PlantUML server: ${url}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
        body: code,
      });
    } catch (error: any) {
      this.logger.error(`PlantUML server unreachable at ${url}: ${error.message}`);
      throw new InternalServerErrorException(
        `Could not reach PlantUML server: ${error.message}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(
        `PlantUML server returned ${response.status} ${response.statusText} for URL ${url}. Body: ${body.slice(0, 500)}`,
      );
      throw new InternalServerErrorException(
        `PlantUML server returned ${response.status}: ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    this.logger.debug(`PlantUML rendered ${buf.length} bytes`);
    return buf;
  }
}

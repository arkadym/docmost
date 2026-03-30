import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DiagramsService } from './diagrams.service';
import { RenderPlantUmlDto } from './dto/render-plantuml.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { FileInterceptor } from '../../common/interceptors/file.interceptor';

@Controller('diagrams')
@UseGuards(JwtAuthGuard)
export class DiagramsController {
  constructor(
    private readonly diagramsService: DiagramsService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  @Post('plantuml/render')
  @HttpCode(HttpStatus.OK)
  async renderPlantUml(
    @Body() dto: RenderPlantUmlDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page || page.workspaceId !== workspace.id) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const attachment = await this.diagramsService.renderPlantUml({
      code: dto.code,
      pageId: dto.pageId,
      userId: user.id,
      spaceId: page.spaceId,
      workspaceId: workspace.id,
      attachmentId: dto.attachmentId,
    });

    return {
      src: `/api/files/${attachment.id}/${attachment.fileName}`,
      attachmentId: attachment.id,
      title: attachment.fileName,
      size: attachment.fileSize,
      updatedAt: attachment.updatedAt,
    };
  }

  @Post('xmind/convert')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor)
  async convertXMind(@Req() req: any) {
    const file = await req.file({
      limits: { fileSize: 50 * 1024 * 1024, files: 1 },
    });

    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const buffer = await file.toBuffer();
    const plantumlCode = await this.diagramsService.convertXMind(buffer);
    return { plantumlCode };
  }
}

import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RenderPlantUmlDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;
}

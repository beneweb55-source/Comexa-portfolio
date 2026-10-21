import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const CHAPTER_ID = /^[a-z0-9][a-z0-9:._-]{0,119}$/;
export class OnboardingDto {
  @IsIn(['personal', 'team', 'comexa', 'client'])
  area!: string;

  // Contrat historique conservé pour les anciens clients.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  step?: number;

  @IsOptional()
  @IsIn(['active', 'paused', 'completed'])
  status?: string;

  @IsOptional()
  @IsIn(['visit', 'complete', 'reopen', 'pause', 'resume', 'restart'])
  operation?: string;

  @ValidateIf(
    (dto: OnboardingDto) =>
      ['visit', 'complete', 'reopen'].includes(dto.operation ?? '') || dto.chapterId !== undefined,
  )
  @IsString()
  @Matches(CHAPTER_ID)
  chapterId?: string;

  @ValidateIf((dto: OnboardingDto) => dto.operation !== undefined || dto.chapterIds !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(400)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(CHAPTER_ID, { each: true })
  chapterIds?: string[];

  @ValidateIf((dto: OnboardingDto) => dto.operation !== undefined || dto.revision !== undefined)
  @IsInt()
  @Min(0)
  revision?: number;
}

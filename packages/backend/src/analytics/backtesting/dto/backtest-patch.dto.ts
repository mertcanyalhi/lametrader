import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * The `PATCH /backtests/:id` request body — a rename.
 *
 * Only a completed backtest can be renamed; renaming a running one is a domain
 * 400 (raised by the run service).
 */
export class BacktestPatchDto {
  /** The new display name (non-empty). */
  @ApiProperty({ description: 'New display name.' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

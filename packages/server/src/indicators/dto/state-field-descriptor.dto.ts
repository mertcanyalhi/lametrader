import { FieldType, Pane, RenderKind } from '@lametrader/core';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnumOptionDto } from './enum-option.dto.js';

/**
 * A numeric state descriptor — mirrors the old TypeBox `NumberStateFieldSchema`
 * (core `NumberStateFieldDescriptor`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class NumberStateFieldDto {
  /** Discriminator: numeric state. */
  @ApiProperty({ enum: [FieldType.Number] })
  type!: FieldType.Number;

  /** Stable key used in the result rows. */
  @ApiProperty()
  key!: string;

  /** Human-readable label for UI / chart legends. */
  @ApiProperty()
  label!: string;

  /** Render hint for a future chart view. */
  @ApiPropertyOptional({ enum: RenderKind })
  render?: RenderKind;

  /** Pane hint for a future chart view. */
  @ApiPropertyOptional({ enum: Pane })
  pane?: Pane;

  /** Default colour hint for a future chart view (CSS string). */
  @ApiPropertyOptional()
  color?: string;
}

/**
 * An enum state descriptor — mirrors the old TypeBox `EnumStateFieldSchema`
 * (core `EnumStateFieldDescriptor`).
 *
 * Documentation only — pins the OpenAPI contract; responses are not validated.
 */
export class EnumStateFieldDto {
  /** Discriminator: enum state. */
  @ApiProperty({ enum: [FieldType.Enum] })
  type!: FieldType.Enum;

  /** Stable key. */
  @ApiProperty()
  key!: string;

  /** Human-readable label. */
  @ApiProperty()
  label!: string;

  /** The closed set of allowed output values. */
  @ApiProperty({ type: EnumOptionDto, isArray: true })
  options!: EnumOptionDto[];

  /** Render hint for a future chart view (typically `markers`). */
  @ApiPropertyOptional({ enum: RenderKind })
  render?: RenderKind;

  /** Pane hint for a future chart view. */
  @ApiPropertyOptional({ enum: Pane })
  pane?: Pane;

  /** Default colour hint for a future chart view (CSS string). */
  @ApiPropertyOptional()
  color?: string;
}

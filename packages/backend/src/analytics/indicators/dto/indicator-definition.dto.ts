import { SymbolType } from '@lametrader/core';
import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  EnumInputFieldDto,
  NumberInputFieldDto,
  SourceInputFieldDto,
} from './input-field-descriptor.dto.js';
import {
  BoolStateFieldDto,
  EnumStateFieldDto,
  NumberStateFieldDto,
} from './state-field-descriptor.dto.js';

/**
 * A serialized indicator `IndicatorDefinition` — the 200 body of the catalog
 * routes (`GET /indicators`, `GET /indicators/:key`). Mirrors the old TypeBox
 * `IndicatorDefinitionSchema`: the input/state descriptors are discriminated
 * unions on `type`, documented here via `oneOf`.
 *
 * Documentation only — pins the OpenAPI contract; the runtime body is the
 * registry's own definition, returned verbatim (never the `compute` function).
 */
@ApiExtraModels(
  NumberInputFieldDto,
  SourceInputFieldDto,
  EnumInputFieldDto,
  NumberStateFieldDto,
  EnumStateFieldDto,
  BoolStateFieldDto,
)
export class IndicatorDefinitionDto {
  /** Stable lookup id — e.g. `sma`. */
  @ApiProperty({ description: 'Stable lookup id (e.g. `sma`).' })
  key!: string;

  /** Human-readable name. */
  @ApiProperty()
  name!: string;

  /** Free-text description. */
  @ApiProperty()
  description!: string;

  /** Schema version — incremented when the input/state shape changes. */
  @ApiProperty()
  version!: number;

  /** Asset classes the indicator is valid for. */
  @ApiProperty({ enum: SymbolType, isArray: true })
  appliesTo!: SymbolType[];

  /** Input parameter descriptors (discriminated on `type`). */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(NumberInputFieldDto) },
        { $ref: getSchemaPath(SourceInputFieldDto) },
        { $ref: getSchemaPath(EnumInputFieldDto) },
      ],
    },
    description: 'Input parameter descriptors.',
  })
  inputs!: (NumberInputFieldDto | SourceInputFieldDto | EnumInputFieldDto)[];

  /** Per-bar state field descriptors (discriminated on `type`). */
  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(NumberStateFieldDto) },
        { $ref: getSchemaPath(EnumStateFieldDto) },
        { $ref: getSchemaPath(BoolStateFieldDto) },
      ],
    },
    description: 'Per-bar state field descriptors.',
  })
  state!: (NumberStateFieldDto | EnumStateFieldDto | BoolStateFieldDto)[];
}

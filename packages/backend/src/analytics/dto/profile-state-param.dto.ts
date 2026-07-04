import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * Path params for `GET /profiles/:profileId/state/global` — mirrors the old
 * TypeBox `ProfileIdParamSchema` on the state controller.
 *
 * The field is named `profileId` (not `id`) because state is a sub-resource of a
 * profile, keyed by that profile's namespace (#281).
 */
export class ProfileStateParamDto {
  /**
   * The profile whose global state map to read.
   */
  @ApiProperty({ description: 'Profile id.' })
  @IsString()
  profileId!: string;
}

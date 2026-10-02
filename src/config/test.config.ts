import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UserEntity } from '../user/user.entity';
import { OrganizationEntity } from '../organization/organization.entity';
import { ArtifactEntity } from '../artifact/artifact.entity';

export const testConfig: TypeOrmModuleOptions = {
  type: 'sqljs',
  autoSave: false,
  entities: [UserEntity, OrganizationEntity, ArtifactEntity],
  synchronize: true,
  dropSchema: true,
  logging: false,
};

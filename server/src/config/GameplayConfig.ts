import { ENABLE_SHOOTER_TEST } from '../../../shared/GameplayConfig';
export const shooterEnabled = ENABLE_SHOOTER_TEST && process.env.ENABLE_SHOOTER_TEST !== 'false';

import { SetMetadata } from '@nestjs/common';

export const ENDPOINT_IS_PUBLIC_KEY = 'isPublic';
export const PublicEndpoint = () => SetMetadata(ENDPOINT_IS_PUBLIC_KEY, true);

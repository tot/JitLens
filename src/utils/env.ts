import { z } from 'zod';

const envSchema = z.object({
	INSTAGRAM_USERNAME: z.string().min(1, 'Instagram username is required'),
	INSTAGRAM_PASSWORD: z.string().min(1, 'Instagram password is required'),
	INSTAGRAM_COOKIE: z.string().min(1, 'Instagram cookie is required').transform((val) => JSON.parse(val)),
});

const env = envSchema.parse({
	INSTAGRAM_USERNAME: process.env.INSTAGRAM_USERNAME,
	INSTAGRAM_PASSWORD: process.env.INSTAGRAM_PASSWORD,
	INSTAGRAM_COOKIE: process.env.INSTAGRAM_COOKIE,
});

export default env;

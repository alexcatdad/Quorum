import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../utils/env";
import { logger } from "../utils/logger";

export class MinIOService {
	private client: S3Client;
	private bucketName: string;

	constructor(env: Env) {
		this.bucketName = env.MINIO_BUCKET_NAME;

		this.client = new S3Client({
			endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
			region: "us-east-1", // MinIO doesn't care about region
			credentials: {
				accessKeyId: env.MINIO_ACCESS_KEY,
				secretAccessKey: env.MINIO_SECRET_KEY,
			},
			forcePathStyle: true, // Required for MinIO
		});

		logger.info(`MinIO service initialized: ${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`);
	}

	async uploadFile(key: string, data: Buffer | Uint8Array | Blob, contentType?: string): Promise<void> {
		try {
			await this.client.send(
				new PutObjectCommand({
					Bucket: this.bucketName,
					Key: key,
					Body: data,
					ContentType: contentType,
				}),
			);

			logger.info(`File uploaded to MinIO: ${key}`);
		} catch (error) {
			logger.error(`Failed to upload file to MinIO: ${key}`, error);
			throw error;
		}
	}

	async getFile(key: string): Promise<ReadableStream | null> {
		try {
			const response = await this.client.send(
				new GetObjectCommand({
					Bucket: this.bucketName,
					Key: key,
				}),
			);

			return response.Body?.transformToWebStream() || null;
		} catch (error) {
			logger.error(`Failed to get file from MinIO: ${key}`, error);
			throw error;
		}
	}

	async deleteFile(key: string): Promise<void> {
		try {
			await this.client.send(
				new DeleteObjectCommand({
					Bucket: this.bucketName,
					Key: key,
				}),
			);

			logger.info(`File deleted from MinIO: ${key}`);
		} catch (error) {
			logger.error(`Failed to delete file from MinIO: ${key}`, error);
			throw error;
		}
	}

	async fileExists(key: string): Promise<boolean> {
		try {
			await this.client.send(
				new HeadObjectCommand({
					Bucket: this.bucketName,
					Key: key,
				}),
			);

			return true;
		} catch (error) {
			return false;
		}
	}

	async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const url = await getSignedUrl(this.client, command, { expiresIn });

			logger.info(`Generated presigned URL for: ${key} (expires in ${expiresIn}s)`);

			return url;
		} catch (error) {
			logger.error(`Failed to generate presigned URL: ${key}`, error);
			throw error;
		}
	}

	async getPresignedUploadUrl(key: string, expiresIn: number = 3600): Promise<string> {
		try {
			const command = new PutObjectCommand({
				Bucket: this.bucketName,
				Key: key,
			});

			const url = await getSignedUrl(this.client, command, { expiresIn });

			logger.info(`Generated presigned upload URL for: ${key} (expires in ${expiresIn}s)`);

			return url;
		} catch (error) {
			logger.error(`Failed to generate presigned upload URL: ${key}`, error);
			throw error;
		}
	}
}

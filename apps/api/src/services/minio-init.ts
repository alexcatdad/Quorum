import {
	CreateBucketCommand,
	HeadBucketCommand,
	PutBucketPolicyCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../utils/env";
import { logger } from "../utils/logger";

export async function initializeMinIOBuckets(env: Env): Promise<void> {
	const client = new S3Client({
		endpoint: `${env.MINIO_USE_SSL ? "https" : "http"}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
		region: "us-east-1",
		credentials: {
			accessKeyId: env.MINIO_ACCESS_KEY,
			secretAccessKey: env.MINIO_SECRET_KEY,
		},
		forcePathStyle: true,
	});

	const buckets = [env.MINIO_BUCKET_NAME, "recordings-raw", "recordings-encoded", "recordings-har"];

	for (const bucketName of buckets) {
		try {
			// Check if bucket exists
			await client.send(new HeadBucketCommand({ Bucket: bucketName }));
			logger.info(`MinIO bucket already exists: ${bucketName}`);
		} catch (error: any) {
			if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
				// Bucket doesn't exist, create it
				try {
					await client.send(new CreateBucketCommand({ Bucket: bucketName }));
					logger.info(`MinIO bucket created: ${bucketName}`);

					// Set bucket policy to allow reading (optional)
					const policy = {
						Version: "2012-10-17",
						Statement: [
							{
								Sid: "PublicRead",
								Effect: "Allow",
								Principal: "*",
								Action: ["s3:GetObject"],
								Resource: [`arn:aws:s3:::${bucketName}/*`],
							},
						],
					};

					try {
						await client.send(
							new PutBucketPolicyCommand({
								Bucket: bucketName,
								Policy: JSON.stringify(policy),
							}),
						);
						logger.info(`Bucket policy set for: ${bucketName}`);
					} catch (policyError) {
						// Policy setting is optional, log but don't fail
						logger.warn(`Failed to set bucket policy for ${bucketName}`, policyError);
					}
				} catch (createError) {
					logger.error(`Failed to create MinIO bucket: ${bucketName}`, createError);
					throw createError;
				}
			} else {
				logger.error(`Failed to check MinIO bucket: ${bucketName}`, error);
				throw error;
			}
		}
	}

	logger.info("MinIO bucket initialization complete");
}

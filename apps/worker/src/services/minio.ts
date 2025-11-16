import { MinIOService } from "../../../api/src/services/minio";

// Create MinIO service instance with environment variables
export const minioService = new MinIOService({
	MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || "localhost",
	MINIO_PORT: Number.parseInt(process.env.MINIO_PORT || "9100", 10),
	MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY || "minioadmin",
	MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY || "minioadmin",
	MINIO_USE_SSL: process.env.MINIO_USE_SSL === "true",
	MINIO_BUCKET_NAME: process.env.MINIO_BUCKET_NAME || "quorum-recordings",
} as any);

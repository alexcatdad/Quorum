import { loadEnv } from "../utils/env";
import { MinIOService } from "./minio";

const env = loadEnv();
export const minioService = new MinIOService(env);

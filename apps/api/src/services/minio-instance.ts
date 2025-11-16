import { MinIOService } from "./minio";
import { loadEnv } from "../utils/env";

const env = loadEnv();
export const minioService = new MinIOService(env);

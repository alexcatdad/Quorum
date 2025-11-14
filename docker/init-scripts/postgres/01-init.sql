-- Quorum Meeting Recorder - PostgreSQL Initialization Script
-- This script runs automatically when the PostgreSQL container is first created
-- It sets up the database with proper extensions and initial configuration

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- Trigram-based text search
CREATE EXTENSION IF NOT EXISTS "btree_gin";      -- GIN index support for btree types

-- Create database schema (Prisma will handle table creation)
-- This just sets up any additional configuration needed

-- Set timezone to UTC for consistency
SET timezone = 'UTC';

-- Grant necessary permissions to the quorum user
GRANT ALL PRIVILEGES ON DATABASE quorum TO quorum;
GRANT ALL PRIVILEGES ON SCHEMA public TO quorum;

-- Log successful initialization
SELECT 'PostgreSQL initialization completed successfully' AS status;

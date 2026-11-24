-- Runs once, only when the postgres container's data volume is first
-- created (see the postgres service's volumes in docker-compose.yml).
-- POSTGRES_DB (from .env) is created automatically by the postgres image;
-- this creates the second database the API tests run against. The name
-- here must match POSTGRES_TEST_DB in .env.example.
CREATE DATABASE comp9820_test;

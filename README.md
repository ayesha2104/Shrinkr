# Shrinkr

A production-ready URL shortener built with Node.js, Express, PostgreSQL, and Redis.

## Live Demo
https://shrinkr-zlrw.onrender.com

> Note: Hosted on Render free tier — 
> first request may take 30-60 seconds to wake up

## Features
- Auto-generate unique short codes
- Redis caching for fast redirects
- Cache invalidation on URL update
- Rate limiting (5 URLs/minute per IP)
- Input validation
- Click tracking

## Tech Stack
- Runtime: Node.js
- Framework: Express.js
- Database: PostgreSQL
- Cache: Redis
- Validation: Joi

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /urls | Create short URL |
| GET | /urls | Get all URLs |
| GET | /urls/:shortCode | Get single URL |
| PUT | /urls/:shortCode | Update URL |
| DELETE | /urls/:shortCode | Delete URL |
| GET | /:shortCode | Redirect to original URL |

## Setup
1. Clone the repo
2. Run `npm install`
3. Create `.env` file (see `.env.example`)
4. Run `node index.js`

## Environment Variables
PORT, DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT,
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
export class AppError extends Error {
	constructor(
		message: string,
		public statusCode: number = 500,
		public code: string = "INTERNAL_ERROR",
		public details?: unknown,
	) {
		super(message);
		this.name = this.constructor.name;
		Error.captureStackTrace(this, this.constructor);
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 400, "VALIDATION_ERROR", details);
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string, id?: string) {
		const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
		super(message, 404, "NOT_FOUND");
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = "Unauthorized") {
		super(message, 401, "UNAUTHORIZED");
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "Forbidden") {
		super(message, 403, "FORBIDDEN");
	}
}

export class ConflictError extends AppError {
	constructor(message: string) {
		super(message, 409, "CONFLICT");
	}
}

export class RateLimitError extends AppError {
	constructor(message = "Too many requests") {
		super(message, 429, "RATE_LIMIT_EXCEEDED");
	}
}

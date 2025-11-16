# Contributing to Quorum

First off, thank you for considering contributing to Quorum! It's people like you that make Quorum such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps to reproduce the problem**
* **Provide specific examples to demonstrate the steps**
* **Describe the behavior you observed and what you expected**
* **Include screenshots if possible**
* **Include your environment details** (OS, Bun version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a detailed description of the suggested enhancement**
* **Explain why this enhancement would be useful**
* **List some examples of how it would be used**

### Pull Requests

* Fill in the required template
* Follow the TypeScript styleguide (enforced by Biome)
* Include tests for new functionality
* Update documentation as needed
* End all files with a newline

## Development Setup

### Prerequisites

- Bun 1.3.2+
- Docker & Docker Compose
- Git

### Setup Steps

1. **Fork and clone the repository**

```bash
git clone https://github.com/your-username/quorum.git
cd quorum
```

2. **Install dependencies**

```bash
bun install
```

3. **Start infrastructure**

```bash
docker-compose up -d
```

4. **Run database migrations**

```bash
cd packages/db
bunx prisma migrate dev
```

5. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your local configuration
```

6. **Start development servers**

```bash
# Terminal 1: API
cd apps/api
bun run dev

# Terminal 2: Worker
cd apps/worker
bun run dev
```

## Project Structure

```
Quorum/
├── apps/
│   ├── api/          # Elysia API server
│   │   ├── src/
│   │   │   ├── routes/       # API endpoints
│   │   │   ├── services/     # Business logic
│   │   │   ├── middleware/   # Request processing
│   │   │   └── utils/        # Helper functions
│   │   └── Dockerfile
│   ├── worker/       # BullMQ job processors
│   │   ├── src/
│   │   │   └── processors/   # Job handlers
│   │   └── Dockerfile
│   └── test-app/     # Package validation
├── packages/
│   ├── db/           # Database schema & migrations
│   ├── shared/       # Shared utilities
│   ├── recorder/     # Recording workers
│   └── encoder/      # Video encoding
└── k8s/              # Deployment manifests
```

## Coding Guidelines

### TypeScript Style

We use Biome for linting and formatting. The configuration is in `biome.json`.

**Key points:**
- Use tabs for indentation
- Use double quotes for strings
- Semicolons are required
- Prefer const over let
- Use arrow functions where appropriate
- Add types for all function parameters and return values

### Example

```typescript
export async function createMeeting(data: CreateMeetingInput): Promise<Meeting> {
	const meeting = await db.meeting.create({
		data: {
			meetingUrl: data.url,
			platform: data.platform,
			organizationId: data.organizationId,
		},
	});

	return meeting;
}
```

### Naming Conventions

- **Files**: kebab-case (e.g., `rate-limit.ts`)
- **Directories**: kebab-case (e.g., `bot-accounts/`)
- **Variables**: camelCase (e.g., `meetingId`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- **Classes**: PascalCase (e.g., `TeamsRecorder`)
- **Interfaces/Types**: PascalCase (e.g., `RecordingConfig`)

## Testing

### Running Tests

```bash
# All tests
bun test

# Specific package
cd apps/api
bun test

# Watch mode
bun test --watch
```

### Writing Tests

- Place test files next to the code they test
- Use `.test.ts` extension
- Use descriptive test names
- Group related tests with `describe`
- Test both success and error cases

```typescript
import { describe, it, expect } from "bun:test";
import { createMeeting } from "./meetings";

describe("createMeeting", () => {
	it("should create a meeting successfully", async () => {
		const meeting = await createMeeting({
			url: "https://teams.microsoft.com/...",
			platform: "TEAMS",
			organizationId: "org-123",
		});

		expect(meeting).toBeDefined();
		expect(meeting.platform).toBe("TEAMS");
	});

	it("should throw error for invalid URL", async () => {
		await expect(
			createMeeting({
				url: "invalid-url",
				platform: "TEAMS",
				organizationId: "org-123",
			})
		).toThrow();
	});
});
```

## Database Changes

### Creating Migrations

```bash
cd packages/db
bunx prisma migrate dev --name your_migration_name
```

### Migration Guidelines

- Keep migrations focused and atomic
- Test migrations both up and down
- Document breaking changes
- Never modify existing migrations
- Include data migrations if schema changes affect existing data

## API Design

### Endpoint Naming

- Use plural nouns for collections: `/meetings`
- Use specific IDs for resources: `/meetings/:id`
- Use verbs for actions: `/meetings/:id/start`
- Avoid deep nesting (max 2 levels)

### Response Format

**Success (200-299):**
```json
{
  "data": { ... }
}
```

**Error (400-599):**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": { ... }
  }
}
```

### Validation

- Use Elysia's built-in validation
- Validate all inputs
- Return descriptive error messages
- Use appropriate HTTP status codes

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(api): add rate limiting middleware

Implement rate limiting with configurable window and max requests.
Includes per-IP, per-user, and per-organization strategies.

Closes #123
```

```
fix(recorder): handle Teams login timeout

Add retry logic for Teams authentication to handle slow networks.

Fixes #456
```

## Pull Request Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code
   - Add tests
   - Update documentation

3. **Run quality checks**
   ```bash
   bun run lint
   bun test
   bun run format:check
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**
   - Use a clear title
   - Reference related issues
   - Describe your changes
   - Include screenshots if UI changes
   - Wait for review

### PR Checklist

- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] Code follows style guidelines
- [ ] Commit messages follow conventions
- [ ] No breaking changes (or documented)
- [ ] Ready for review

## Code Review Process

- All PRs require at least one approval
- Address review comments promptly
- Keep discussions focused and professional
- Be open to feedback

## Getting Help

- **Discord**: [Join our community](https://discord.gg/quorum)
- **GitHub Discussions**: Ask questions and share ideas
- **Issues**: Report bugs and request features
- **Email**: team@quorum.example.com

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md file
- Release notes
- Project README

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to Quorum! 🎉

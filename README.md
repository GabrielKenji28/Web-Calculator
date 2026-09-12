# Web Calculator

This repository contains a full-stack calculator created as a take-home assessment for a Software Engineer role. It pairs a React and TypeScript frontend with a Go REST service, with an emphasis on correctness, clarity, and maintainability.

All seven operations work through the Go service: addition, subtraction, multiplication, division, power, square root, and percentage. The application uses the real HTTP client; fixture adapters are used only by tests. A multi-stage Docker build packages the frontend and API into one container.

## Recommended setup: Docker

**Docker is the recommended way to build and run the project.** It provides a reproducible environment with the expected Node 24 and Go 1.27 toolchains, so evaluating the application does not require installing either toolchain locally. You only need Docker with Compose and a running Docker engine.

Run these commands from the repository root:

```bash
docker compose up --build -d
docker compose ps
```

Open <http://localhost:8080>. Go serves the built React assets and API from the same origin. The image runs as a non-root user and checks `/health`; Compose allows 15 seconds for graceful shutdown.

```bash
docker compose logs calculator
docker compose down
```

## Local setup (alternative)

To run the project without Docker:

| Tool    | Version                                |
| ------- | -------------------------------------- |
| Go      | 1.27, matching `backend/go.mod`          |
| Node.js | 24, matching `frontend/.nvmrc`           |
| npm     | Version bundled with the Node 24 release |

Node 24 is the documented local version and is pinned in `frontend/.nvmrc`, so `nvm use` selects it. The compatibility floor is declared in `frontend/package.json`, and dependencies are locked in `frontend/package-lock.json`.

## Local development

Start the backend in one terminal:

```bash
cd backend
go run ./cmd/server
```

Start the frontend in another terminal, from the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` and `/health` to Go on port `8080`, keeping browser requests on the same origin.

The interface is a phone-style calculator: one display above a four-column keypad. Enter a number, press an operation, enter the second number, press `=`. `√x` and `x²` act on the displayed number immediately. `x²` is a shortcut for `power` with an exponent of `2`, so it costs a request like anything else — the browser performs no arithmetic of its own. `+/−` is the one exception, and it only edits the sign of the number you are typing.

The answer stays on screen and can start the next calculation: `5`, `×`, `4`, `=` shows `20`, and pressing `+`, `3`, `=` then shows `23`. What carries forward is the exact number the service returned, never the rounded text standing in for it on screen.

Only one operation at a time, though. Once a second operand is on screen the operation keys are disabled, so `2 + 3 × 4` cannot be entered at all — press `=` or Clear. Until then you can still change your mind about the operation, so a mis-tap costs nothing: another operator swaps the armed one (`5`, `+`, `×` waits on `5 ×`), and `√x` or `x²` drops the pending operation and answers straight away (`5`, `xʸ`, `x²` shows `25`). Either way exactly one calculation runs. There is no expression parser and no operator precedence to learn.

A **Help** button in the header opens a dialog explaining every operation key, with a worked example for each and the four errors a key can produce. Nothing in it is written by hand: the rows are generated from `contract/fixtures.json` at build time, so an example cannot drift from what the service actually answers, and a fixture that stops resolving fails the build.

The physical keyboard mirrors the keypad: digits, `.`, `+`, `-`, `*`, `/`, `^`, `%`, `Enter` or `=` to evaluate, `Escape` to clear, and `Backspace`.

Every calculation goes to the service. Requests time out after 10 seconds, including a stalled response body. Loading disables duplicate submissions; connection errors, timeouts, and arithmetic errors allow another attempt without reloading. Clear resets the display and discards any pending result.

Server settings:

| Flag                | Environment default | Default                               |
| ------------------- | ------------------- | ------------------------------------- |
| `-port`             | `PORT`              | `8080`; `0` chooses an available port |
| `-static-dir`       | `STATIC_DIR`        | Empty: serve only the API             |
| `-shutdown-timeout` | —                   | `10s`                                 |

SIGINT/SIGTERM initiates graceful shutdown, allowing in-flight requests to finish within the shutdown timeout. If the backend port changes during Vite development, update the proxy target in `frontend/vite.config.ts` too.

## Production-style local run

To build and run the production application locally without Docker, use these commands from the repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
go -C backend run ./cmd/server -static-dir ../frontend/dist
```

The static directory must contain `index.html`; an incomplete build fails at startup. The server serves the page and existing assets, returns 404 for missing files, and does not expose directory listings. API routing stays independent of static serving.

## API

### `GET /health`

Returns HTTP `200` with `{"status":"ok"}`.

### `POST /api/v1/calculate`

Send one JSON object containing exactly `operation` and `operands`. Operation names are case-sensitive and operands must be finite JSON numbers.

| Operation    | Operands             | Meaning                 |
| ------------ | -------------------- | ----------------------- |
| `add`        | `[x, y]`             | x + y                   |
| `subtract`   | `[x, y]`             | x − y                   |
| `multiply`   | `[x, y]`             | x × y                   |
| `divide`     | `[x, y]`             | x ÷ y                   |
| `power`      | `[base, exponent]`   | base raised to exponent |
| `sqrt`       | `[x]`                | Principal square root   |
| `percentage` | `[percentage, base]` | X percent of Y          |

Calculation and health responses have `Content-Type: application/json`.

```text
200  {"result": <number>}
400  {"error":{"code":"...","message":"..."}}
500  {"error":{"code":"INTERNAL_ERROR","message":"An unexpected server error occurred."}}
```

The service rejects malformed JSON, missing/extra fields, trailing data, wrong types, null operands, non-finite numeric literals such as `1e309`, and incorrect operand counts. Unknown API paths return a plain 404; wrong methods return a plain 405 with an `Allow` header.

| Error code          | HTTP | Meaning                                                                      |
| ------------------- | ---- | ---------------------------------------------------------------------------- |
| `INVALID_REQUEST`   | 400  | Invalid body, types, fields, arity, or non-finite input                      |
| `UNKNOWN_OPERATION` | 400  | Unsupported operation name                                                   |
| `DIVISION_BY_ZERO`  | 400  | Divisor is zero, including `-0`                                              |
| `NEGATIVE_SQRT`     | 400  | Square root of a negative number                                             |
| `INVALID_POWER`     | 400  | Zero with a negative exponent, or a negative base with a fractional exponent |
| `NON_FINITE_RESULT` | 400  | Result exceeds the finite binary64 range                                     |
| `INTERNAL_ERROR`    | 500  | Unexpected server fault                                                      |

### Examples

Run in a POSIX shell, such as Git Bash, with the service on port 8080. Requests and expected responses below come from the shared fixtures and are checked against the running service.

```console
$ curl -s http://localhost:8080/health
{"status":"ok"}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"add","operands":[10,2]}'
{"result":12}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"divide","operands":[10,0]}'
{"error":{"code":"DIVISION_BY_ZERO","message":"Cannot divide by zero."}}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"ADD","operands":[1,2]}'
{"error":{"code":"UNKNOWN_OPERATION","message":"Operation is not supported."}}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"add","operands":[0.1,0.2]}'
{"result":0.30000000000000004}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"multiply","operands":[-0,2]}'
{"result":0}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"add","operands":[1e308,1e308]}'
{"error":{"code":"NON_FINITE_RESULT","message":"Calculation result is outside the finite number range."}}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"add","operands":["1",2]}'
{"error":{"code":"INVALID_REQUEST","message":"Provide one JSON object with an operation and the required finite numeric operands."}}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"power","operands":[0,0]}'
{"result":1}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"sqrt","operands":[9]}'
{"result":3}

$ curl -s -X POST http://localhost:8080/api/v1/calculate \
    -H 'Content-Type: application/json' \
    -d '{"operation":"percentage","operands":[15,200]}'
{"result":30}
```

## Numerical assumptions

Numbers use IEEE 754 binary64. Inputs and results must be finite; overflow is an arithmetic error, and NaN or Infinity never appears in a JSON result. Underflow follows binary64 behavior and can yield zero.

The API returns the unrounded result and normalizes negative zero. The UI uses the contract's 12-significant-digit display policy, removes insignificant trailing zeros, and shows the exact value alongside a rounded result. For example, the API returns `0.30000000000000004` for `0.1 + 0.2`, while the main display shows `0.3`. At the finite limits, where rounding itself would overflow, the display preserves the exact finite value.

Division by either signed zero is an error. Square roots require a non-negative operand and use one input. `0^0` is defined as `1`; zero with a negative exponent and a negative base with a fractional exponent are errors. Negative and fractional exponents otherwise work.

Percentage means **X percent of Y**, evaluated as `(percentage / 100) * base`. Thus `[15, 200]` returns `30`. Negative percentages and percentages above 100 are allowed. On the keypad `%` is a binary operator rather than the usual phone-calculator `÷ 100`: press `15`, `%`, `200`, `=`. The expression line reads `15 % of`.

## Tests and coverage

One command runs both suites and prints both coverage summaries:

```bash
make coverage        # or: bash scripts/coverage.sh
```

`make verify` (or `bash scripts/verify.sh`) runs the full gate instead: formatting, vet, both suites, the type-check and the production build. The scripts are the source of truth and need only bash, so they work where `make` is not installed; `make` just wraps them. Both refuse to run rather than installing dependencies behind your back.

What that runs, if you would rather drive it yourself:

```bash
go -C backend test ./... -coverprofile=coverage.out
go -C backend tool cover -func=coverage.out
go -C backend vet ./...
gofmt -l backend
npm --prefix frontend test -- --run --coverage
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Pull requests targeting `main` run the same quality gates in GitHub Actions. The
workflow publishes two stable checks: **Backend tests** runs formatting, vet, and
the full Go suite with coverage and the race detector; **Frontend tests** installs
the locked dependencies, runs the Vitest suite with coverage, type-checks, and
builds the production bundle.

To make those checks block merging, configure a branch ruleset for `main` in
**Settings → Rules → Rulesets**. Require a pull request and require the
**Backend tests** and **Frontend tests** status checks. Enable “Require branches
to be up to date before merging” if every pull request must be retested against
the latest `main`.

The race detector needs cgo and a C compiler, which Windows development machines often lack. The Linux Go image supplies one:

```bash
docker run --rm -v "$PWD:/src" -w /src/backend golang:1.27 go test ./... -race
```

That was run against this tree and passes clean across all packages. No C compiler is needed to build or run the application itself.

Measured on the current tree:

| Package                         | Statements                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `backend/internal/calc`         | **100.0%**                                                                                                               |
| `backend/internal/httpapi`      | **98.4%**                                                                                                                |
| `backend/cmd/server`            | 83.1%                                                                                                                    |
| `backend/internal/contracttest` | 0.0% — test-only fixture loader, exercised entirely from the packages above, so per-package coverage cannot attribute it |
| Go total                        | 75.8%                                                                                                                    |

Frontend: **262 tests**, 94.6% statements, 90.5% branches, 99.1% functions, 97.8% lines.

The Go total is held down by the fixture loader having no tests of its own. The packages carrying the behaviour — arithmetic and HTTP — are at 100% and 98.4%.

The backend suite asserts all **80** shared fixtures: **79** real request/response cases and one injected internal failure. It repeats the contract through the production static/API composition. The frontend tests replay every preview fixture: 36 of the 44 are driven through real keypad presses, and the 8 whose operands a keypad cannot express — `1e308`-scale values and a 16-digit mantissa — go through a stubbed client instead, with a test naming those eight so the gap cannot widen unnoticed. They also cover the injected server failure, HTTP validation, timeout and connection recovery, keypad and physical-keyboard entry, the error-code copy map, accessible display announcements, and number formatting.

## Shared contract

`contract/fixtures.json` holds 80 golden cases: 52 core and 28 advanced. Requests, responses, operation names and arities, error messages, and numerical policies were frozen before implementation. Both test suites consume this file.

- `request.body` is raw text so malformed JSON, an empty body, signed zero, and out-of-range literals retain their meaning. HTTP tests replay those bytes.
- `expected.body` is parsed JSON; tests compare values rather than whitespace.
- `testFault` requests a test-only injected failure. It is never sent over HTTP, and production has no failure switch.
- `preview: true` identifies 44 UI-reachable cases, including the injected failure. The fixture adapter now lives only under `frontend/src/test/`.
- JavaScript serializes values such as `-0` and `1e308` differently from their stored literals. The test adapter compares canonical serialized requests and checks that collisions have identical responses.

## Design decisions

1. **One calculation endpoint.** An operation name and operands array cover unary and binary calculations. A stable error envelope gives clients both a machine-readable code and a readable message.
2. **Shared golden fixtures.** One reviewed contract supplies expectations to both test suites. Keeping raw request text permits validation cases a typed request object cannot express.
3. **Pure arithmetic behind a thin HTTP layer.** `internal/calc` has no HTTP imports. The handler validates requests and maps arithmetic errors in one place; injecting the calculator makes unexpected failures testable without a production trigger.
4. **Strict input validation.** Pointer fields and raw JSON operands preserve missing, null, and wrongly typed values instead of silently coercing them. Input and arithmetic errors return 400; unexpected faults return a sanitized 500 and are logged.
5. **Explicit numerical semantics.** Finite binary64 results remain unrounded in transport, with rounding confined to presentation. Percentage means X percent of Y, and exponent edge cases have documented outcomes.
6. **Small, accessible React keypad, doing one operation at a time.** One display above a four-column keypad, in the shape of a phone calculator. Every key is a real button with a spoken label, the display is a single live region that is never remounted, physical-keyboard entry mirrors the keys, and plain responsive CSS covers the layout with no UI or state library. The palette is a committed dark violet; there is no light theme. A result can seed the next calculation, but chained expressions cannot be entered at all: the operation keys are disabled once a second operand exists. That removes operator precedence and expression parsing from the product rather than resolving their ambiguity in code, and continuation carries the raw binary64 result so a rounded display never becomes an operand.
7. **In-app help generated from the contract, not written.** The Help dialog derives every row from the same `contract/fixtures.json` the two test suites assert against: each operation key is matched to a preview fixture, and its worked example is rendered from that fixture's own operands and result. Documentation that restates behaviour drifts from it; documentation computed from the source of truth cannot. A key the contract can no longer illustrate throws at import rather than rendering a stale example.
8. **One HTTP client with bounded requests.** Components perform no arithmetic or direct fetches. The client validates responses and handles timeout and connection failures; runtime fixture selection was retired at integration.
9. **One production process and origin.** The multi-stage build produces frontend assets and a static Go executable, then copies only those into a non-root runtime image. Optional static serving keeps the same executable useful for local API development.

## Scope

Included: all seven operations, responsive and keyboard-accessible UI, tests with coverage, pull-request CI checks, API documentation, and Docker packaging.

Excluded: authentication, a database, persisted calculation history, expression parsing, additional state or component libraries, and OpenAPI generation.

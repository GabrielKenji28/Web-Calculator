package httpapi

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/GabrielKenji28/Web-Calculator/backend/internal/calc"
	"github.com/GabrielKenji28/Web-Calculator/backend/internal/contracttest"
)

func TestStaticFiles(t *testing.T) {
	t.Parallel()

	directory := frontendBuild(t)
	router, err := WithStaticFiles(newTestRouter(t, calc.New()), directory)
	if err != nil {
		t.Fatalf("WithStaticFiles(%q): %v", directory, err)
	}

	tests := []struct {
		name       string
		method     string
		target     string
		wantStatus int
		wantBody   string
		wantType   string
		wantAllow  string
	}{
		{name: "root page", method: http.MethodGet, target: "/", wantStatus: http.StatusOK, wantBody: "<!doctype html><title>Calculator</title>", wantType: "text/html"},
		{name: "head page", method: http.MethodHead, target: "/", wantStatus: http.StatusOK, wantType: "text/html"},
		{name: "stylesheet", method: http.MethodGet, target: "/assets/app.css", wantStatus: http.StatusOK, wantBody: "body { margin: 0; }", wantType: "text/css"},
		{name: "javascript", method: http.MethodGet, target: "/assets/app.js", wantStatus: http.StatusOK, wantBody: "export {};", wantType: "javascript"},
		{name: "missing asset", method: http.MethodGet, target: "/assets/missing.js", wantStatus: http.StatusNotFound},
		{name: "unknown page", method: http.MethodGet, target: "/missing", wantStatus: http.StatusNotFound},
		{name: "directory listing", method: http.MethodGet, target: "/assets/", wantStatus: http.StatusNotFound},
		{name: "unknown API", method: http.MethodGet, target: "/api/v1/missing", wantStatus: http.StatusNotFound},
		{name: "API root", method: http.MethodGet, target: "/api", wantStatus: http.StatusNotFound},
		{name: "API method", method: http.MethodGet, target: "/api/v1/calculate", wantStatus: http.StatusMethodNotAllowed, wantAllow: "POST"},
		{name: "health method", method: http.MethodPost, target: "/health", wantStatus: http.StatusMethodNotAllowed, wantAllow: "GET, HEAD"},
		{name: "unknown health path", method: http.MethodGet, target: "/health/missing", wantStatus: http.StatusNotFound},
		{name: "unknown POST", method: http.MethodPost, target: "/calculate", wantStatus: http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.target, nil))
			if rec.Code != tt.wantStatus {
				t.Fatalf("%s %s status = %d, want %d: %s", tt.method, tt.target, rec.Code, tt.wantStatus, rec.Body.String())
			}
			if tt.wantStatus == http.StatusOK && rec.Body.String() != tt.wantBody {
				t.Errorf("%s %s body = %q, want %q", tt.method, tt.target, rec.Body.String(), tt.wantBody)
			}
			if tt.wantType != "" && !strings.Contains(rec.Header().Get("Content-Type"), tt.wantType) {
				t.Errorf("Content-Type = %q, want it to contain %q", rec.Header().Get("Content-Type"), tt.wantType)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}

func TestStaticFilesPreserveContract(t *testing.T) {
	t.Parallel()

	fixtures := contracttest.Load(t)
	directory := frontendBuild(t)
	for _, tc := range fixtures.Cases {
		t.Run(tc.ID, func(t *testing.T) {
			t.Parallel()

			var calculator Calculator = calc.New()
			if tc.TestFault != "" {
				calculator = failingCalculator{err: fs.ErrInvalid}
			}
			router, err := WithStaticFiles(newTestRouter(t, calculator), directory)
			if err != nil {
				t.Fatalf("WithStaticFiles: %v", err)
			}
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, fixtureRequest(tc))
			assertResponse(t, rec, tc.Expected)
		})
	}
}

func TestStaticFilesRequireFrontendBuild(t *testing.T) {
	t.Parallel()

	directory := t.TempDir()
	indexDirectory := t.TempDir()
	if err := os.Mkdir(filepath.Join(indexDirectory, "index.html"), 0o755); err != nil {
		t.Fatalf("create directory in place of index: %v", err)
	}
	tests := []struct {
		name      string
		directory string
	}{
		{name: "missing directory", directory: filepath.Join(directory, "missing")},
		{name: "missing index", directory: directory},
		{name: "index is a directory", directory: indexDirectory},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if _, err := WithStaticFiles(newTestRouter(t, calc.New()), tt.directory); err == nil {
				t.Errorf("WithStaticFiles(%q) succeeded, want an invalid build error", tt.directory)
			}
		})
	}
}

func frontendBuild(t *testing.T) string {
	t.Helper()

	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0o755); err != nil {
		t.Fatalf("create assets directory: %v", err)
	}
	files := map[string]string{
		"index.html":     "<!doctype html><title>Calculator</title>",
		"assets/app.css": "body { margin: 0; }",
		"assets/app.js":  "export {};",
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(directory, filepath.FromSlash(name)), []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return directory
}

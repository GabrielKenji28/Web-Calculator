package httpapi

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// WithStaticFiles serves a frontend build alongside api. The directory must
// contain index.html. API and health requests always use the original router,
// including its 404 and 405 responses. There is no client-side route fallback:
// this calculator has a single page, and missing assets should return 404.
func WithStaticFiles(api http.Handler, directory string) (http.Handler, error) {
	files := os.DirFS(directory)
	index, err := fs.Stat(files, "index.html")
	if err != nil {
		return nil, fmt.Errorf("read frontend index: %w", err)
	}
	if !index.Mode().IsRegular() {
		return nil, fmt.Errorf("frontend index.html must be a regular file")
	}

	static := http.FileServerFS(staticFiles{FS: files})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") ||
			r.URL.Path == "/health" || strings.HasPrefix(r.URL.Path, "/health/") {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			// Preserve the API-only router's response for unsupported routes.
			api.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	}), nil
}

// staticFiles prevents directory listings while keeping net/http's normal
// index.html handling, content types, conditional requests, and HEAD support.
type staticFiles struct {
	fs.FS
}

func (s staticFiles) Open(name string) (fs.File, error) {
	file, err := s.FS.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err == nil && info.IsDir() {
		var index fs.FileInfo
		index, err = fs.Stat(s.FS, path.Join(name, "index.html"))
		if err == nil && !index.Mode().IsRegular() {
			err = fs.ErrNotExist
		}
	}
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return file, nil
}

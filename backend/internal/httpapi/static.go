package httpapi

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// No client-side route fallback: this is a single-page app, and missing
// assets return 404 rather than index.html.
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
			api.ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	}), nil
}

// Prevents directory listings; otherwise defers to net/http's normal handling.
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

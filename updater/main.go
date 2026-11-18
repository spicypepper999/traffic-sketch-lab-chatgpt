// Traffic Sketch Lab: one-time Windows updater. Standard library only.
// It fetches the latest published release and caches the actual game locally.
// No source checkout, Node.js installation or external package is required.
package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	repository  = "spicypepper999/traffic-sketch-lab-chatgpt"
	assetName   = "TrafficSketchLab-Windows.zip"
	appFolder   = "TrafficSketchLab"
	maxZIPBytes = 100 << 20
)

var versionTag = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

type release struct {
	Tag    string `json:"tag_name"`
	Assets []struct {
		ID     int64  `json:"id"`
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		Digest string `json:"digest"`
	} `json:"assets"`
}

type githubAPI struct {
	client *http.Client
	token  string
}

func (g githubAPI) fetch(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "TrafficSketchLab-Updater/1.0")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}
	return g.client.Do(req)
}

func (g githubAPI) latest() (release, error) {
	var item release
	url := "https://api.github.com/repos/" + repository + "/releases/latest"
	res, err := g.fetch(url)
	if err != nil {
		return item, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusForbidden {
			return item, fmt.Errorf("GitHub denied release access (HTTP %d); check your token and repository permissions", res.StatusCode)
		}
		return item, fmt.Errorf("GitHub releases request failed (HTTP %d)", res.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&item); err != nil {
		return item, err
	}
	if !versionTag.MatchString(item.Tag) {
		return item, fmt.Errorf("invalid release version: %q", item.Tag)
	}
	return item, nil
}

func (r release) asset() (int64, error) {
	for _, a := range r.Assets {
		if a.Name == assetName && a.Size > 0 && a.Size <= maxZIPBytes {
			return a.ID, nil
		}
	}
	return 0, fmt.Errorf("release %s has no usable %s attachment", r.Tag, assetName)
}

func (g githubAPI) download(assetID int64, to string) error {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/assets/%d", repository, assetID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "TrafficSketchLab-Updater/1.0")
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if g.token != "" {
		req.Header.Set("Authorization", "Bearer "+g.token)
	}
	res, err := g.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("release asset request failed (HTTP %d)", res.StatusCode)
	}
	if !strings.Contains(strings.ToLower(res.Header.Get("Content-Type")), "octet-stream") &&
		!strings.Contains(strings.ToLower(res.Header.Get("Content-Type")), "zip") {
		return fmt.Errorf("GitHub did not return a ZIP download (content type %q)", res.Header.Get("Content-Type"))
	}
	if res.ContentLength > maxZIPBytes {
		return fmt.Errorf("release file exceeds size limit")
	}
	f, err := os.Create(to)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := io.Copy(f, io.LimitReader(res.Body, maxZIPBytes+1))
	if err != nil {
		return err
	}
	if n > maxZIPBytes {
		return fmt.Errorf("release download exceeded size limit")
	}
	if n < 100 {
		return fmt.Errorf("release download is unexpectedly small")
	}
	return f.Sync()
}

func unzipGame(file, dest string) error {
	r, err := zip.OpenReader(file)
	if err != nil {
		return err
	}
	defer r.Close()
	found := false
	for _, entry := range r.File {
		// This updater intentionally extracts only the known game executable.
		// Other archive entries and path traversal attempts cannot be written.
		if entry.Name != "TrafficSketchLab.exe" {
			continue
		}
		if entry.FileInfo().IsDir() || entry.UncompressedSize64 > 120<<20 {
			return fmt.Errorf("invalid game executable")
		}
		rd, err := entry.Open()
		if err != nil {
			return err
		}
		target := filepath.Join(dest, "TrafficSketchLab.exe")
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
		if err != nil {
			rd.Close()
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(rd, 120<<20+1))
		closeErr := out.Close()
		rd.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n > 120<<20 {
			return fmt.Errorf("expanded executable too large")
		}
		found = true
		break
	}
	if !found {
		return errors.New("release archive contains no TrafficSketchLab.exe")
	}
	return nil
}

func dataDirectory() (string, error) {
	home := os.Getenv("LOCALAPPDATA")
	if home == "" {
		var err error
		home, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
	}
	return filepath.Join(home, appFolder), nil
}
func installed(dir string) (string, string) {
	bs, err := os.ReadFile(filepath.Join(dir, "current-version.txt"))
	if err != nil {
		return "", ""
	}
	tag := strings.TrimSpace(string(bs))
	if !versionTag.MatchString(tag) {
		return "", ""
	}
	exe := filepath.Join(dir, "versions", tag, "TrafficSketchLab.exe")
	if st, err := os.Stat(exe); err != nil || st.Size() < 100 {
		return "", ""
	}
	return tag, exe
}
func install(api githubAPI, rel release, root string) (string, error) {
	assetID, err := rel.asset()
	if err != nil {
		return "", err
	}
	versions := filepath.Join(root, "versions")
	if err = os.MkdirAll(versions, 0700); err != nil {
		return "", err
	}
	target := filepath.Join(versions, rel.Tag)
	exe := filepath.Join(target, "TrafficSketchLab.exe")
	if stat, err := os.Stat(exe); err == nil && stat.Size() > 100 {
		if err = os.WriteFile(filepath.Join(root, "current-version.txt"), []byte(rel.Tag+"\n"), 0600); err != nil {
			return "", err
		}
		return exe, nil
	}
	scratch, err := os.MkdirTemp(root, "download-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(scratch)
	zipPath := filepath.Join(scratch, "download.zip")
	fmt.Printf("Downloading %s ...\n", rel.Tag)
	if err = api.download(assetID, zipPath); err != nil {
		return "", err
	}
	if err = unzipGame(zipPath, scratch); err != nil {
		return "", err
	}
	if err = os.MkdirAll(target, 0700); err != nil {
		return "", err
	}
	if err = os.Rename(filepath.Join(scratch, "TrafficSketchLab.exe"), exe); err != nil {
		return "", err
	}
	if err = os.WriteFile(filepath.Join(root, "current-version.txt"), []byte(rel.Tag+"\n"), 0600); err != nil {
		return "", err
	}
	// Retain one previous version for offline fallback; all earlier versions removed.
	entries, _ := os.ReadDir(versions)
	for _, e := range entries {
		if e.IsDir() && e.Name() != rel.Tag {
			_ = os.RemoveAll(filepath.Join(versions, e.Name()))
		}
	}
	return exe, nil
}
func launch(exe string) error {
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	return cmd.Run()
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		fmt.Fprintln(os.Stderr, "Press Enter to exit.")
		fmt.Scanln()
		os.Exit(1)
	}
}
func run() error {
	// GitHub Actions: verify a real private release can be fetched and unpacked
	// with a short-lived CI token; no credentials are persisted in this mode.
	if len(os.Args) > 1 && os.Args[1] == "--check-github" {
		token := os.Getenv("TSL_GITHUB_TOKEN")
		if token == "" {
			return errors.New("TSL_GITHUB_TOKEN is required for release-access check")
		}
		api := githubAPI{client: &http.Client{Timeout: 40 * time.Second}, token: token}
		rel, err := api.latest()
		if err != nil {
			return err
		}
		id, err := rel.asset()
		if err != nil {
			return err
		}
		dir, err := os.MkdirTemp("", "traffic-sketch-updater-check-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		zipped := filepath.Join(dir, "release.zip")
		if err = api.download(id, zipped); err != nil {
			return err
		}
		if err = unzipGame(zipped, dir); err != nil {
			return err
		}
		fmt.Println("Verified private GitHub release", rel.Tag, "and extracted the game executable.")
		return nil
	}
	root, err := dataDirectory()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return err
	}
	credentials := filepath.Join(root, "auth.dat")
	if len(os.Args) > 1 && os.Args[1] == "--reset-auth" {
		if err = os.Remove(credentials); err != nil && !os.IsNotExist(err) {
			return err
		}
		fmt.Println("Saved GitHub access removed. It will be requested on next launch.")
		return nil
	}
	cachedTag, cachedExe := installed(root)
	if len(os.Args) > 1 && os.Args[1] == "--offline" {
		if cachedExe == "" {
			return errors.New("no downloaded game yet; launch normally while online first")
		}
		fmt.Println("Starting cached", cachedTag)
		return launch(cachedExe)
	}
	token, err := readCredential(credentials)
	if err != nil {
		return fmt.Errorf("couldn't unlock Windows credential; use --reset-auth: %w", err)
	}
	api := githubAPI{client: &http.Client{Timeout: 30 * time.Second}, token: token}
	latest, fetchErr := api.latest()
	if fetchErr != nil && token == "" {
		// A private repository returns 404 without authorization. Ask once.
		fmt.Println("The game's GitHub release is private and requires read-only access.")
		fmt.Println("Create a fine-grained token at:")
		fmt.Println("https://github.com/settings/personal-access-tokens/new")
		fmt.Println("Limit it to repository 'traffic-sketch-lab-chatgpt' with Contents: Read-only.")
		token, err = promptSecret("Paste token (hidden): ")
		if err != nil {
			return err
		}
		if len(token) < 12 {
			return errors.New("token was empty or invalid")
		}
		api.token = token
		latest, fetchErr = api.latest()
		if fetchErr == nil {
			if err = writeCredential(credentials, token); err != nil {
				return fmt.Errorf("cannot save encrypted token: %w", err)
			}
		}
	}
	if fetchErr != nil {
		if cachedExe == "" {
			return fmt.Errorf("cannot check for releases: %w", fetchErr)
		}
		fmt.Printf("Update check unavailable (%v); starting cached %s.\n", fetchErr, cachedTag)
		return launch(cachedExe)
	}
	if latest.Tag == cachedTag && cachedExe != "" {
		fmt.Println("Traffic Sketch Lab", latest.Tag, "is up to date.")
		return launch(cachedExe)
	}
	fmt.Println("Latest:", latest.Tag, "| installed:", cachedTag)
	exe, err := install(api, latest, root)
	if err != nil {
		if cachedExe == "" {
			return fmt.Errorf("update failed: %w", err)
		}
		fmt.Println("Update failed:", err, "— launching cached version", cachedTag)
		return launch(cachedExe)
	}
	return launch(exe)
}

package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestReleaseAsset(t *testing.T) {
	r := release{Tag: "v0.8.0"}
	r.Assets = append(r.Assets, struct {
		ID     int64  `json:"id"`
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		Digest string `json:"digest"`
	}{ID: 42, Name: assetName, Size: 1234})
	id, err := r.asset()
	if err != nil || id != 42 {
		t.Fatalf("asset=%d err=%v", id, err)
	}
}
func TestZipOnlyExtractsGame(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "test.zip")
	f, _ := os.Create(p)
	w := zip.NewWriter(f)
	for _, name := range []string{"../../evil.txt", "TrafficSketchLab.exe"} {
		fw, _ := w.Create(name)
		fw.Write([]byte("a test binary"))
	}
	w.Close()
	f.Close()
	dest := filepath.Join(dir, "cache")
	os.MkdirAll(dest, 0700)
	if err := unzipGame(p, dest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "evil.txt")); !os.IsNotExist(err) {
		t.Fatal("zip traversal wrote outside destination")
	}
	if _, err := os.Stat(filepath.Join(dest, "TrafficSketchLab.exe")); err != nil {
		t.Fatal(err)
	}
}
func TestVersionTag(t *testing.T) {
	for _, s := range []string{"v0.8.0", "v12.24.123"} {
		if !versionTag.MatchString(s) {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"../v1.0.0", "v1.0.0-dev", "v1.2"} {
		if versionTag.MatchString(s) {
			t.Fatal(s)
		}
	}
}

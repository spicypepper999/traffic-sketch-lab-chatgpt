package main

import (
    "embed"
    "fmt"
    "io/fs"
    "log"
    "net"
    "net/http"
    "os"
    "os/exec"
    "runtime"
)

//go:embed web
var assets embed.FS

func main() {
    root, err := fs.Sub(assets, "web")
    if err != nil { log.Fatal(err) }
    l, err := net.Listen("tcp", "127.0.0.1:0")
    if err != nil { log.Fatal("Unable to open local server: ", err) }
    url := "http://" + l.Addr().String() + "/"
    server := &http.Server{Handler:http.FileServer(http.FS(root))}
    fmt.Println("Traffic Sketch Lab v0.5 — standalone Windows launcher")
    fmt.Println("Open: ", url)
    fmt.Println("Keep this window open while playing. Close it to quit.")
    if runtime.GOOS == "windows" {
        if err := exec.Command("cmd", "/c", "start", "", url).Start(); err != nil { fmt.Fprintln(os.Stderr, "Browser could not be launched automatically:", err) }
    }
    if err := server.Serve(l); err != http.ErrServerClosed { log.Fatal(err) }
}

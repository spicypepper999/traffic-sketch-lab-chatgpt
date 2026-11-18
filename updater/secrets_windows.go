//go:build windows

package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"
)

type dataBlob struct {
	size  uint32
	bytes *byte
}

var (
	cryptDLL       = syscall.NewLazyDLL("crypt32.dll")
	cryptProtect   = cryptDLL.NewProc("CryptProtectData")
	cryptUnprotect = cryptDLL.NewProc("CryptUnprotectData")
	localFree      = syscall.NewLazyDLL("kernel32.dll").NewProc("LocalFree")
	kernel         = syscall.NewLazyDLL("kernel32.dll")
	consoleMode    = kernel.NewProc("GetConsoleMode")
	setMode        = kernel.NewProc("SetConsoleMode")
)

func blobOf(b []byte) dataBlob {
	if len(b) == 0 {
		return dataBlob{}
	}
	return dataBlob{size: uint32(len(b)), bytes: &b[0]}
}
func dpapi(b []byte, encrypt bool) ([]byte, error) {
	input := blobOf(b)
	var output dataBlob
	proc := cryptUnprotect
	var args []uintptr
	if encrypt {
		proc = cryptProtect
		args = []uintptr{uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&output))}
	} else {
		args = []uintptr{uintptr(unsafe.Pointer(&input)), 0, 0, 0, 0, 1, uintptr(unsafe.Pointer(&output))}
	}
	ret, _, err := proc.Call(args...)
	if ret == 0 {
		return nil, fmt.Errorf("Windows DPAPI error: %w", err)
	}
	defer localFree.Call(uintptr(unsafe.Pointer(output.bytes)))
	if output.size == 0 || output.size > 100000 {
		return nil, errors.New("invalid encrypted token")
	}
	return append([]byte(nil), unsafe.Slice(output.bytes, output.size)...), nil
}
func readCredential(file string) (string, error) {
	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	clear, err := dpapi(data, false)
	if err != nil {
		return "", err
	}
	return string(clear), nil
}
func writeCredential(file, token string) error {
	encrypted, err := dpapi([]byte(token), true)
	if err != nil {
		return err
	}
	return os.WriteFile(file, encrypted, 0600)
}
func promptSecret(message string) (string, error) {
	fmt.Print(message)
	handle := os.Stdin.Fd()
	var mode uint32
	yes, _, _ := consoleMode.Call(uintptr(handle), uintptr(unsafe.Pointer(&mode)))
	if yes == 0 {
		return "", errors.New("cannot hide console input; launch the updater from a normal console window")
	}
	const enableEchoInput = 4
	yes, _, _ = setMode.Call(uintptr(handle), uintptr(mode&^enableEchoInput))
	if yes == 0 {
		return "", errors.New("could not disable console echo")
	}
	defer setMode.Call(uintptr(handle), uintptr(mode))
	str, err := bufio.NewReader(os.Stdin).ReadString('\n')
	fmt.Println()
	return strings.TrimSpace(str), err
}

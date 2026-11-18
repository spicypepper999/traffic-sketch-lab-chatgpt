//go:build windows

package main

import "testing"

func TestDPAPIRoundTrip(t *testing.T) {
	payload := []byte("a test-only token that is not an actual secret")
	encrypted, err := dpapi(payload, true)
	if err != nil {
		t.Fatal(err)
	}
	if string(encrypted) == string(payload) {
		t.Fatal("encryption not applied")
	}
	decrypted, err := dpapi(encrypted, false)
	if err != nil {
		t.Fatal(err)
	}
	if string(decrypted) != string(payload) {
		t.Fatal("round trip failed")
	}
}

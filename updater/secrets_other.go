//go:build !windows

package main

import "errors"

func readCredential(string) (string, error) { return "", errors.New("this updater is for Windows") }
func writeCredential(string, string) error  { return errors.New("this updater is for Windows") }
func promptSecret(string) (string, error)   { return "", errors.New("this updater is for Windows") }

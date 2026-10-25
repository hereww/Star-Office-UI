// Independent stdlib-only check of the Go host's raw Ed25519 + SHA-256 semantics.
// This helper does not implement/modify any telemetry API or installer contract.
package main

import (
	"archive/zip"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

func verify(path, trustedKey, expectedKeyID string) error {
	public, err := base64.StdEncoding.DecodeString(trustedKey)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid trusted key")
	}
	archive, err := zip.OpenReader(path)
	if err != nil {
		return err
	}
	defer archive.Close()
	entries := map[string][]byte{}
	for _, file := range archive.File {
		reader, err := file.Open()
		if err != nil {
			return err
		}
		data, readErr := io.ReadAll(reader)
		closeErr := reader.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if _, exists := entries[file.Name]; exists {
			return fmt.Errorf("duplicate entry")
		}
		entries[file.Name] = data
	}
	var signature struct {
		Algorithm string `json:"algorithm"`
		KeyID     string `json:"key_id"`
		Signature string `json:"signature"`
	}
	if err := json.Unmarshal(entries["signature.json"], &signature); err != nil {
		return err
	}
	if signature.Algorithm != "ed25519" || signature.KeyID != expectedKeyID {
		return fmt.Errorf("wrong signature metadata")
	}
	sig, err := base64.StdEncoding.DecodeString(signature.Signature)
	if err != nil || !ed25519.Verify(public, entries["manifest.json"], sig) {
		return fmt.Errorf("signature failed")
	}
	var manifest struct {
		Files map[string]string `json:"files"`
	}
	if err := json.Unmarshal(entries["manifest.json"], &manifest); err != nil {
		return err
	}
	if len(entries) != len(manifest.Files)+2 {
		return fmt.Errorf("unexpected contents")
	}
	for path, expected := range manifest.Files {
		data, ok := entries[path]
		if !ok {
			return fmt.Errorf("missing payload")
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != expected {
			return fmt.Errorf("hash failed: %s", path)
		}
	}
	return nil
}

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "usage: helper package public-key-base64 key-id")
		os.Exit(2)
	}
	if err := verify(os.Args[1], os.Args[2], os.Args[3]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Go Ed25519 signature and all payload hashes verified")
}

package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
)

var (
	encryptionKeys             map[int][]byte
	activeEncryptionKeyVersion int
)

// InitEncryption loads a versioned keyring. ENCRYPTION_KEYS is a JSON object
// such as {"1":"base64...","2":"base64..."}; ENCRYPTION_KEY_VERSION names
// the active write key. ENCRYPTION_KEY remains a development-compatible v1
// fallback, but persisted rows always record their key version.
func InitEncryption() error {
	keys := map[int][]byte{}
	if rawKeyring := os.Getenv("ENCRYPTION_KEYS"); rawKeyring != "" {
		var encoded map[string]string
		if err := json.Unmarshal([]byte(rawKeyring), &encoded); err != nil {
			return fmt.Errorf("invalid ENCRYPTION_KEYS JSON: %w", err)
		}
		for rawVersion, rawKey := range encoded {
			version, err := strconv.Atoi(rawVersion)
			if err != nil || version < 1 {
				return fmt.Errorf("invalid encryption key version %q", rawVersion)
			}
			key, err := decodeEncryptionKey(rawKey)
			if err != nil {
				return fmt.Errorf("invalid encryption key version %d: %w", version, err)
			}
			keys[version] = key
		}
	} else {
		rawKey := os.Getenv("ENCRYPTION_KEY")
		if rawKey == "" {
			return errors.New("ENCRYPTION_KEYS or ENCRYPTION_KEY environment variable is required")
		}
		key, err := decodeEncryptionKey(rawKey)
		if err != nil {
			return err
		}
		keys[1] = key
	}

	version := 1
	if rawVersion := os.Getenv("ENCRYPTION_KEY_VERSION"); rawVersion != "" {
		parsed, err := strconv.Atoi(rawVersion)
		if err != nil || parsed < 1 {
			return errors.New("ENCRYPTION_KEY_VERSION must be a positive integer")
		}
		version = parsed
	}
	if _, ok := keys[version]; !ok {
		return fmt.Errorf("active encryption key version %d is not present in the keyring", version)
	}
	encryptionKeys = keys
	activeEncryptionKeyVersion = version
	return nil
}

func decodeEncryptionKey(raw string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("encryption key must be base64: %w", err)
	}
	if len(key) != 32 {
		return nil, errors.New("encryption key must be 32 bytes when base64 decoded")
	}
	return key, nil
}

func ActiveEncryptionKeyVersion() int { return activeEncryptionKeyVersion }

func EncryptToken(plaintext string) (string, error) {
	return EncryptTokenAtVersion(plaintext, activeEncryptionKeyVersion)
}

func EncryptTokenAtVersion(plaintext string, version int) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	key, ok := encryptionKeys[version]
	if !ok {
		return "", fmt.Errorf("encryption key version %d is unavailable", version)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func DecryptToken(ciphertext string) (string, error) {
	return DecryptTokenAtVersion(ciphertext, activeEncryptionKeyVersion)
}

func DecryptTokenAtVersion(ciphertext string, version int) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
	key, ok := encryptionKeys[version]
	if !ok {
		return "", fmt.Errorf("encryption key version %d is unavailable", version)
	}
	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, encrypted := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

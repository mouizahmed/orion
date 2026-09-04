package recordingstorage

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/recordingaudio"
	"github.com/mouizahmed/justscribe-backend/internal/storage"
)

const (
	ffmpegPathEnv          = "RECORDING_AUDIO_FFMPEG_PATH"
	manifestName           = "recording.json"
	remoteCleanupMarker    = ".remote-upload-pending"
	manifestLimit          = 256 * 1024
	remoteCleanupMarkerMax = 16
)

type Finalizer struct {
	spool      *recordingaudio.Store
	b2         *storage.B2Client
	ffmpegPath string
}

type manifest struct {
	Version    int                `json:"version"`
	SessionID  string             `json:"session_id"`
	NoteID     string             `json:"note_id"`
	Codec      string             `json:"codec"`
	Container  string             `json:"container"`
	SampleRate int                `json:"sample_rate"`
	Channels   int                `json:"channels"`
	Sources    []manifestArtifact `json:"sources"`
}

type manifestArtifact struct {
	Source    string `json:"source"`
	Artifact  string `json:"artifact"`
	SizeBytes int64  `json:"size_bytes"`
	SHA1      string `json:"sha1"`
}

type encodedArtifact struct {
	manifestArtifact
	path string
}

func NewFinalizer(spool *recordingaudio.Store, b2 *storage.B2Client) (*Finalizer, error) {
	ffmpegPath := strings.TrimSpace(os.Getenv(ffmpegPathEnv))
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	resolvedPath, err := exec.LookPath(ffmpegPath)
	if err != nil {
		return nil, fmt.Errorf("resolve recording Opus encoder: %w", err)
	}
	return &Finalizer{spool: spool, b2: b2, ffmpegPath: resolvedPath}, nil
}

// Finalize stores a server spool as Ogg Opus. A committed local manifest is
// retained as a receipt until the recording session is marked complete.
func (f *Finalizer) Finalize(
	ctx context.Context,
	session *models.RecordingSession,
	requested string,
) (stored string, finalErr error) {
	if f == nil || f.spool == nil || session == nil {
		return "", errors.New("recording audio finalizer is unavailable")
	}
	artifacts, err := f.spool.Seal(session.UserID, session.ID)
	if err != nil {
		cleanupErr := f.spool.Cleanup(session.UserID, session.ID)
		return "", errors.Join(err, cleanupErr)
	}
	if !artifacts.Exists {
		if requested == models.RecordingAudioStoredLocal {
			return requested, nil
		}
		return models.RecordingAudioStoredNone, nil
	}
	manifestPath := filepath.Join(artifacts.Directory, manifestName)
	committedManifest, err := readCommittedManifest(manifestPath, session)
	if err != nil {
		return "", err
	}
	if committedManifest {
		if requested != models.RecordingAudioStoredCloud {
			return "", errors.New("recording audio storage mode changed after cloud commit")
		}
		if err := removeRemoteCleanupMarker(artifacts.Directory); err != nil {
			return "", err
		}
		return models.RecordingAudioStoredCloud, nil
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		cleanupErr := f.cleanupUncommitted(session.UserID, session.ID)
		if cleanupErr != nil {
			stored = ""
			finalErr = errors.Join(finalErr, fmt.Errorf("clean incomplete recording audio: %w", cleanupErr))
		}
	}()
	if requested != models.RecordingAudioStoredCloud {
		return requested, nil
	}
	if f.b2 == nil {
		return "", errors.New("recording object storage is unavailable")
	}

	encoded := make([]encodedArtifact, 0, 2)
	for _, source := range []struct {
		name      string
		artifact  string
		spoolPath string
		source    recordingaudio.Source
	}{
		{name: "mic", artifact: "microphone.ogg", spoolPath: artifacts.MicrophonePath, source: recordingaudio.SourceMicrophone},
		{name: "system", artifact: "system.ogg", spoolPath: artifacts.SystemPath, source: recordingaudio.SourceSystem},
	} {
		item, exists, encodeErr := f.encode(ctx, source.name, source.artifact, source.spoolPath, source.source, artifacts.Directory)
		if encodeErr != nil {
			return "", encodeErr
		}
		if exists {
			encoded = append(encoded, item)
		}
	}
	if len(encoded) == 0 {
		return models.RecordingAudioStoredNone, nil
	}
	if err := writeRemoteCleanupMarker(artifacts.Directory); err != nil {
		return "", err
	}

	for _, artifact := range encoded {
		_, uploadErr := f.upload(ctx, session, artifact.path, artifact.Artifact, "audio/ogg", artifact.SHA1, artifact.SizeBytes, artifact.Source)
		if uploadErr != nil {
			return "", uploadErr
		}
	}

	pendingManifestPath := manifestPath + ".pending"
	manifestSHA1, manifestSize, err := writeManifest(pendingManifestPath, manifest{
		Version:    1,
		SessionID:  session.ID,
		NoteID:     session.NoteID,
		Codec:      "opus",
		Container:  "ogg",
		SampleRate: 48_000,
		Channels:   1,
		Sources:    manifestArtifacts(encoded),
	})
	if err != nil {
		return "", err
	}
	_, err = f.upload(ctx, session, pendingManifestPath, manifestName, "application/json", manifestSHA1, manifestSize, "manifest")
	if err != nil {
		return "", err
	}
	if err := os.Rename(pendingManifestPath, manifestPath); err != nil {
		return "", fmt.Errorf("commit recording upload receipt: %w", err)
	}
	if err := removeRemoteCleanupMarker(artifacts.Directory); err != nil {
		return "", err
	}
	committed = true
	return models.RecordingAudioStoredCloud, nil
}

// Cleanup removes a finalized spool after its database completion is durable.
func (f *Finalizer) CleanupFinalized(session *models.RecordingSession) error {
	if f == nil || f.spool == nil || session == nil {
		return errors.New("recording audio finalizer is unavailable")
	}
	return f.spool.Cleanup(session.UserID, session.ID)
}

// Cleanup removes an inactive spool. A durable marker means remote objects
// were exposed without a committed recording and must be deleted first.
func (f *Finalizer) Cleanup(userID, sessionID string) error {
	if f == nil || f.spool == nil {
		return errors.New("recording audio finalizer is unavailable")
	}
	artifacts, err := f.spool.Seal(userID, sessionID)
	if err != nil || !artifacts.Exists {
		return err
	}
	pending, err := hasRemoteCleanupMarker(artifacts.Directory)
	if err != nil {
		return err
	}
	if pending {
		return f.cleanupUncommitted(userID, sessionID)
	}
	return f.spool.Cleanup(userID, sessionID)
}

// CleanupAbandoned forces remote cleanup even if upload completion was locally
// recorded, because the authoritative recording session did not complete.
func (f *Finalizer) CleanupAbandoned(userID, sessionID string) error {
	if f == nil || f.spool == nil {
		return errors.New("recording audio finalizer is unavailable")
	}
	artifacts, err := f.spool.Seal(userID, sessionID)
	if err != nil || !artifacts.Exists {
		return err
	}
	if err := writeRemoteCleanupMarker(artifacts.Directory); err != nil {
		return err
	}
	return f.cleanupUncommitted(userID, sessionID)
}

func (f *Finalizer) ListSessions() ([]models.RecordingSessionIdentity, error) {
	if f == nil || f.spool == nil {
		return nil, errors.New("recording audio finalizer is unavailable")
	}
	return f.spool.ListSessions()
}

func (f *Finalizer) cleanupUncommitted(userID, sessionID string) error {
	artifacts, err := f.spool.Seal(userID, sessionID)
	if err != nil || !artifacts.Exists {
		return err
	}
	pending, err := hasRemoteCleanupMarker(artifacts.Directory)
	if err != nil {
		return err
	}
	if pending {
		if f.b2 == nil {
			return errors.New("recording object storage is unavailable for cleanup")
		}
		var cleanupErr error
		for _, artifactName := range []string{"microphone.ogg", "system.ogg", manifestName} {
			cleanupErr = errors.Join(
				cleanupErr,
				f.b2.DeleteFile(recordingObjectName(userID, sessionID, artifactName)),
			)
		}
		if cleanupErr != nil {
			return fmt.Errorf("delete incomplete recording objects: %w", cleanupErr)
		}
	}
	return f.spool.Cleanup(userID, sessionID)
}

func readCommittedManifest(path string, session *models.RecordingSession) (bool, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect recording upload receipt: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > manifestLimit {
		return false, errors.New("recording upload receipt is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return false, fmt.Errorf("open recording upload receipt: %w", err)
	}
	defer file.Close()
	var value manifest
	decoder := json.NewDecoder(io.LimitReader(file, manifestLimit+1))
	if err := decoder.Decode(&value); err != nil {
		return false, fmt.Errorf("decode recording upload receipt: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return false, err
	}
	if value.Version != 1 || value.SessionID != session.ID || value.NoteID != session.NoteID ||
		value.Codec != "opus" || value.Container != "ogg" || value.SampleRate != 48_000 || value.Channels != 1 ||
		len(value.Sources) == 0 || len(value.Sources) > 2 {
		return false, errors.New("recording upload receipt does not match the session")
	}
	seen := make(map[string]bool, len(value.Sources))
	for _, source := range value.Sources {
		expectedArtifact := ""
		switch source.Source {
		case "mic":
			expectedArtifact = "microphone.ogg"
		case "system":
			expectedArtifact = "system.ogg"
		default:
			return false, errors.New("recording upload receipt source is invalid")
		}
		checksum, decodeErr := hex.DecodeString(source.SHA1)
		if seen[source.Source] || source.Artifact != expectedArtifact || source.SizeBytes <= 0 || decodeErr != nil || len(checksum) != sha1.Size {
			return false, errors.New("recording upload receipt artifact is invalid")
		}
		seen[source.Source] = true
	}
	return true, nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("recording upload receipt contains trailing data")
		}
		return fmt.Errorf("decode recording upload receipt tail: %w", err)
	}
	return nil
}

func (f *Finalizer) encode(
	ctx context.Context,
	sourceName string,
	artifactName string,
	spoolPath string,
	source recordingaudio.Source,
	directory string,
) (encodedArtifact, bool, error) {
	info, err := os.Stat(spoolPath)
	if os.IsNotExist(err) {
		return encodedArtifact{}, false, nil
	}
	if err != nil {
		return encodedArtifact{}, false, fmt.Errorf("inspect %s recording spool: %w", sourceName, err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 {
		return encodedArtifact{}, false, fmt.Errorf("%s recording spool is invalid", sourceName)
	}

	temporaryPath := filepath.Join(directory, artifactName+".tmp")
	finalPath := filepath.Join(directory, artifactName)
	command := exec.CommandContext(ctx, f.ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "pipe:0",
		"-c:a", "libopus", "-b:a", "48k", "-vbr", "on", "-application", "audio",
		"-f", "ogg", temporaryPath,
	)
	// Encoder diagnostics can include private spool paths. Discard them and
	// retain only typed operation context plus the process exit status.
	command.Stderr = io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		return encodedArtifact{}, false, fmt.Errorf("open %s encoder input: %w", sourceName, err)
	}
	if err := command.Start(); err != nil {
		return encodedArtifact{}, false, fmt.Errorf("start %s Opus encoder: %w", sourceName, err)
	}
	copied, copyErr := recordingaudio.CopyPCM(ctx, spoolPath, source, stdin)
	closeErr := stdin.Close()
	waitErr := command.Wait()
	if copyErr != nil || closeErr != nil || waitErr != nil || copied == 0 {
		_ = os.Remove(temporaryPath)
		if copied == 0 && copyErr == nil {
			copyErr = errors.New("recording spool contained no PCM")
		}
		return encodedArtifact{}, false, fmt.Errorf("encode %s recording as Opus: %w", sourceName, errors.Join(copyErr, closeErr, waitErr))
	}
	if err := os.Chmod(temporaryPath, 0o600); err != nil {
		_ = os.Remove(temporaryPath)
		return encodedArtifact{}, false, fmt.Errorf("protect %s Opus recording: %w", sourceName, err)
	}
	if err := os.Remove(finalPath); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(temporaryPath)
		return encodedArtifact{}, false, fmt.Errorf("replace %s Opus recording: %w", sourceName, err)
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		_ = os.Remove(temporaryPath)
		return encodedArtifact{}, false, fmt.Errorf("commit %s Opus recording: %w", sourceName, err)
	}
	checksum, size, err := hashFile(finalPath)
	if err != nil {
		return encodedArtifact{}, false, err
	}
	return encodedArtifact{
		manifestArtifact: manifestArtifact{Source: sourceName, Artifact: artifactName, SizeBytes: size, SHA1: checksum},
		path:             finalPath,
	}, true, nil
}

func (f *Finalizer) upload(
	ctx context.Context,
	session *models.RecordingSession,
	path string,
	artifactName string,
	contentType string,
	checksum string,
	size int64,
	source string,
) (string, error) {
	uploadURL, err := f.b2.GetUploadURL()
	if err != nil {
		return "", fmt.Errorf("obtain recording upload URL: %w", err)
	}
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open recording artifact for upload: %w", err)
	}
	defer file.Close()
	objectName := recordingObjectName(session.UserID, session.ID, artifactName)
	uploaded, err := f.b2.UploadReader(
		ctx,
		uploadURL.UploadURL,
		uploadURL.AuthorizationToken,
		objectName,
		contentType,
		size,
		checksum,
		map[string]string{
			"orion-note-id":      session.NoteID,
			"orion-session-id":   session.ID,
			"orion-audio-source": source,
			"orion-processing":   "opus",
		},
		file,
	)
	if err != nil {
		return "", fmt.Errorf("upload recording artifact: %w", err)
	}
	if uploaded.FileName != objectName || uploaded.FileSize != size {
		_ = f.b2.DeleteFile(objectName)
		return "", errors.New("recording upload response did not match the artifact")
	}
	return objectName, nil
}

func writeManifest(path string, value manifest) (string, int64, error) {
	temporaryPath := path + ".tmp"
	if err := os.Remove(temporaryPath); err != nil && !os.IsNotExist(err) {
		return "", 0, fmt.Errorf("replace recording manifest temporary file: %w", err)
	}
	file, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", 0, fmt.Errorf("create recording manifest: %w", err)
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(value)
	syncErr := file.Sync()
	closeErr := file.Close()
	if err := errors.Join(encodeErr, syncErr, closeErr); err != nil {
		_ = os.Remove(temporaryPath)
		return "", 0, fmt.Errorf("write recording manifest: %w", err)
	}
	info, err := os.Stat(temporaryPath)
	if err != nil || info.Size() <= 0 || info.Size() > manifestLimit {
		_ = os.Remove(temporaryPath)
		return "", 0, errors.New("recording manifest size is invalid")
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(temporaryPath)
		return "", 0, fmt.Errorf("replace recording manifest: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return "", 0, fmt.Errorf("commit recording manifest: %w", err)
	}
	checksum, size, err := hashFile(path)
	return checksum, size, err
}

func hashFile(path string) (string, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, fmt.Errorf("open recording artifact for hashing: %w", err)
	}
	defer file.Close()
	hash := sha1.New()
	size, err := io.CopyBuffer(hash, file, make([]byte, 64*1024))
	if err != nil {
		return "", 0, fmt.Errorf("hash recording artifact: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}

func manifestArtifacts(encoded []encodedArtifact) []manifestArtifact {
	result := make([]manifestArtifact, len(encoded))
	for index := range encoded {
		result[index] = encoded[index].manifestArtifact
	}
	return result
}

func recordingObjectName(userID, sessionID, artifactName string) string {
	return "recordings/" + userID + "/" + sessionID + "/" + artifactName
}

func writeRemoteCleanupMarker(directory string) error {
	path := filepath.Join(directory, remoteCleanupMarker)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if os.IsExist(err) {
		pending, inspectErr := hasRemoteCleanupMarker(directory)
		if inspectErr != nil {
			return inspectErr
		}
		if pending {
			return nil
		}
	}
	if err != nil {
		return fmt.Errorf("create recording remote cleanup marker: %w", err)
	}
	_, writeErr := file.WriteString("1\n")
	syncErr := file.Sync()
	closeErr := file.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("write recording remote cleanup marker: %w", err)
	}
	return nil
}

func hasRemoteCleanupMarker(directory string) (bool, error) {
	info, err := os.Lstat(filepath.Join(directory, remoteCleanupMarker))
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect recording remote cleanup marker: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > remoteCleanupMarkerMax {
		return false, errors.New("recording remote cleanup marker is invalid")
	}
	return true, nil
}

func removeRemoteCleanupMarker(directory string) error {
	err := os.Remove(filepath.Join(directory, remoteCleanupMarker))
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return fmt.Errorf("commit recording remote cleanup state: %w", err)
}
